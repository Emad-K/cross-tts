/// <reference lib="webworker" />
import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import type { PronunciationRule } from "@shared/ttsTextRules";
import { phonemizeForKokoro } from "./kokoroPhonemize";
import { KOKORO_MODEL_ID, type KokoroVoiceId } from "./kokoroVoices";

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

type InitMessage = {
	type: "init";
	hubBaseUrl: string | null;
	device: KokoroDevice;
	dtype: KokoroDtype;
	numThreads: number;
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
		loadPromise = KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
			dtype: init.dtype,
			device: init.device,
			progress_callback: (info) => {
				if (info.status === "progress") {
					ctx.postMessage({ type: "progress", value: info.progress / 100 });
				}
			},
		})
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
		void load(msg)
			.then((model) => {
				ctx.postMessage({ type: "ready", voices: voiceOptions(model) });
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
				const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
				const raw = await tts.generate_from_ids(input_ids, {
					voice: msg.voice,
					speed: msg.speed,
				});
				const src = raw.audio as Float32Array;
				// Copy into a fresh, exact-size buffer we can transfer (zero-copy).
				const buffer = src.buffer.slice(
					src.byteOffset,
					src.byteOffset + src.byteLength,
				);
				ctx.postMessage(
					{
						type: "result",
						id: msg.id,
						audio: new Float32Array(buffer),
						samplingRate: raw.sampling_rate,
					},
					[buffer],
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
