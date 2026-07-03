/// <reference lib="webworker" />
import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import type { PronunciationRule } from "@shared/ttsTextRules";
import { phonemizeForKokoro } from "./kokoroPhonemize";
import { splitPhonemesForTokenLimit } from "./phonemeTokenSplit";
import { KOKORO_MODEL_ID, type KokoroVoiceId } from "./kokoroVoices";

/**
 * Kokoro's tokenizer truncates at model_max_length 512 — silently dropping the
 * end of the sentence AND the EOS token (garbled tail). One phoneme char is at
 * most one token, so pieces this long always fit, with room for BOS/EOS.
 */
const MAX_PHONEME_TOKENS = 500;

/**
 * TTS runs entirely in this worker so the synchronous ONNX Runtime inference
 * never blocks the renderer's main thread (which previously froze the whole UI
 * while a sentence synthesized). The worker loads the model, phonemizes, and
 * generates audio; the main thread only schedules playback.
 */

type KokoroDevice = "webgpu" | "wasm";
type KokoroDtype = NonNullable<
	Parameters<typeof KokoroTTS.from_pretrained>[1]
>["dtype"];

type GpuPower = "auto" | "high-performance" | "low-power";

type InitMessage = {
	type: "init";
	hubBaseUrl: string | null;
	device: KokoroDevice;
	dtype: KokoroDtype;
	numThreads: number;
	gpuPower: GpuPower;
};

type GenerateMessage = {
	type: "generate";
	id: number;
	text: string;
	voice: KokoroVoiceId;
	speed: number;
	pronunciationRules: PronunciationRule[];
};

type InMessage = InitMessage | GenerateMessage;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let tts: KokoroTTS | null = null;
let loadPromise: Promise<KokoroTTS> | null = null;

async function selectGpuAdapter(power: GpuPower): Promise<void> {
	// WebGPU can't pick a GPU by name — only a power hint, which on multi-GPU
	// machines selects the dedicated (high-performance) vs integrated (low-power)
	// adapter. Request it ourselves and hand it to ORT (the non-deprecated path).
	if (power === "auto") return;
	try {
		if (typeof navigator === "undefined" || !navigator.gpu) return;
		const adapter = await navigator.gpu.requestAdapter({
			powerPreference: power,
		});
		const webgpu = env.backends?.onnx?.webgpu as
			| { adapter?: unknown; powerPreference?: string }
			| undefined;
		if (webgpu) {
			if (adapter) webgpu.adapter = adapter;
			webgpu.powerPreference = power;
		}
	} catch {
		// Fall back to ORT's default adapter selection.
	}
}

function load(init: InitMessage): Promise<KokoroTTS> {
	if (tts) return Promise.resolve(tts);
	if (!loadPromise) {
		if (init.hubBaseUrl) {
			env.remoteHost = init.hubBaseUrl;
			env.useBrowserCache = false;
		}
		const wasm = env.backends?.onnx?.wasm;
		if (wasm && init.device === "wasm") {
			wasm.numThreads = init.numThreads;
		}
		loadPromise = (
			init.device === "webgpu"
				? selectGpuAdapter(init.gpuPower)
				: Promise.resolve()
		)
			.then(() =>
				KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
					dtype: init.dtype,
					device: init.device,
					progress_callback: (info) => {
						if (info.status === "progress") {
							ctx.postMessage({ type: "progress", value: info.progress / 100 });
						}
					},
				}),
			)
			.then((model) => {
				tts = model;
				return model;
			})
			.catch((e) => {
				loadPromise = null;
				throw e;
			});
	}
	return loadPromise;
}

function voiceOptions(
	model: KokoroTTS,
): { id: string; label: string }[] {
	const voices = model.voices as Record<
		string,
		{ name: string; language?: string }
	>;
	return Object.keys(voices).map((id) => {
		const meta = voices[id];
		const lang = meta.language ? ` · ${meta.language}` : "";
		return { id, label: `${meta.name} (${id})${lang}` };
	});
}

ctx.onmessage = (event: MessageEvent<InMessage>) => {
	const msg = event.data;

	if (msg.type === "init") {
		const startedAt = performance.now();
		void load(msg)
			.then((model) => {
				ctx.postMessage({
					type: "ready",
					voices: voiceOptions(model),
					loadMs: Math.round(performance.now() - startedAt),
				});
			})
			.catch((e: unknown) => {
				ctx.postMessage({
					type: "initError",
					message: e instanceof Error ? e.message : String(e),
				});
			});
		return;
	}

	if (msg.type === "generate") {
		void (async () => {
			const startedAt = performance.now();
			try {
				if (!tts) {
					ctx.postMessage({
						type: "result",
						id: msg.id,
						error: "Model not loaded",
					});
					return;
				}
				const phonemes = await phonemizeForKokoro(
					msg.text,
					msg.voice,
					msg.pronunciationRules,
				);
				if (phonemes.trim() === "") {
					ctx.postMessage({ type: "result", id: msg.id, empty: true });
					return;
				}
				// Chunks whose phonemes exceed the tokenizer limit are synthesized in
				// punctuation-aligned pieces and the audio concatenated — otherwise the
				// tokenizer would silently truncate and the tail would go unspoken.
				const pieces = splitPhonemesForTokenLimit(phonemes, MAX_PHONEME_TOKENS);
				const audios: Float32Array[] = [];
				let samplingRate = 24000;
				for (const piece of pieces) {
					if (piece.trim() === "") continue;
					const { input_ids } = tts.tokenizer(piece, { truncation: true });
					const raw = await tts.generate_from_ids(input_ids, {
						voice: msg.voice,
						speed: msg.speed,
					});
					samplingRate = raw.sampling_rate;
					audios.push(raw.audio as Float32Array);
				}
				if (audios.length === 0) {
					ctx.postMessage({ type: "result", id: msg.id, empty: true });
					return;
				}
				// Join into a fresh, exact-size buffer we can transfer (zero-copy).
				const totalLength = audios.reduce((n, a) => n + a.length, 0);
				const joined = new Float32Array(totalLength);
				let offset = 0;
				for (const a of audios) {
					joined.set(a, offset);
					offset += a.length;
				}
				ctx.postMessage(
					{
						type: "result",
						id: msg.id,
						audio: joined,
						samplingRate,
						synthMs: Math.round(performance.now() - startedAt),
					},
					[joined.buffer],
				);
			} catch (e) {
				ctx.postMessage({
					type: "result",
					id: msg.id,
					error: e instanceof Error ? e.message : String(e),
				});
			}
		})();
	}
};
