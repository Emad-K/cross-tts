import {
	AutoTokenizer,
	StyleTextToSpeech2Model,
	env,
} from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import { phonemizeForKokoro } from "../mainview/features/reader/tts/kokoroPhonemize";
import { splitPhonemesForTokenLimit } from "../mainview/features/reader/tts/phonemeTokenSplit";
import { KOKORO_MODEL_ID } from "../mainview/features/reader/tts/kokoroVoices";
import type { KokoroVoiceId } from "../mainview/features/reader/tts/kokoroVoices";
import type {
	TtsNodeGenerateParams,
	TtsNodeVoiceOption,
} from "../shared/ttsNodeRpc";

/**
 * Native CPU TTS backend: an Electron utility process running kokoro-js on
 * onnxruntime-node. fp32 here is ~2.5× faster than the renderer's WASM q8 path
 * (native q8 is *slower* than fp32 — dequant overhead dominates on the CPU EP).
 * Mirrors ttsWorker.ts (the renderer WASM/WebGPU worker): same phonemization,
 * same token-limit splitting, same result shape.
 */

const DTYPE = "fp32";

/**
 * Kokoro's tokenizer truncates at model_max_length 512 — silently dropping the
 * end of the sentence AND the EOS token (garbled tail). One phoneme char is at
 * most one token, so pieces this long always fit, with room for BOS/EOS.
 */
const MAX_PHONEME_TOKENS = 500;

type InMessage =
	| { type: "init"; hubBaseUrl: string | null; numThreads: number }
	| ({ type: "generate"; id: number } & TtsNodeGenerateParams);

const parentPort = process.parentPort;

let tts: KokoroTTS | null = null;
let loadPromise: Promise<KokoroTTS> | null = null;

function load(
	hubBaseUrl: string | null,
	numThreads: number,
): Promise<KokoroTTS> {
	if (tts) return Promise.resolve(tts);
	if (!loadPromise) {
		if (hubBaseUrl) {
			// Fetch through the main process's caching hub proxy so the native and
			// renderer backends share one on-disk model cache; skip transformers.js's
			// own FS cache to avoid storing the weights twice.
			env.remoteHost = hubBaseUrl;
			env.useFSCache = false;
			env.allowLocalModels = false;
		}
		// Not KokoroTTS.from_pretrained: it doesn't forward session_options, and
		// the user's thread preference (Settings → Performance) must reach the
		// native ORT session. 0 = auto (ORT's default: one per physical core).
		loadPromise = Promise.all([
			StyleTextToSpeech2Model.from_pretrained(KOKORO_MODEL_ID, {
				dtype: DTYPE,
				device: "cpu",
				session_options:
					numThreads > 0 ? { intraOpNumThreads: numThreads } : {},
				progress_callback: (info) => {
					if (info.status === "progress") {
						parentPort.postMessage({
							type: "progress",
							value: info.progress / 100,
						});
					}
				},
			}),
			AutoTokenizer.from_pretrained(KOKORO_MODEL_ID),
		])
			.then(([model, tokenizer]) => {
				tts = new KokoroTTS(model, tokenizer);
				return tts;
			})
			.catch((e) => {
				loadPromise = null;
				throw e;
			});
	}
	return loadPromise;
}

function voiceOptions(model: KokoroTTS): TtsNodeVoiceOption[] {
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

parentPort.on("message", (event) => {
	const msg = event.data as InMessage;

	if (msg.type === "init") {
		const startedAt = performance.now();
		void load(msg.hubBaseUrl, msg.numThreads)
			.then((model) => {
				parentPort.postMessage({
					type: "ready",
					voices: voiceOptions(model),
					loadMs: Math.round(performance.now() - startedAt),
				});
			})
			.catch((e: unknown) => {
				parentPort.postMessage({
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
					parentPort.postMessage({
						type: "result",
						id: msg.id,
						error: "Model not loaded",
					});
					return;
				}
				const phonemes = await phonemizeForKokoro(
					msg.text,
					msg.voice as KokoroVoiceId,
					msg.pronunciationRules,
				);
				if (phonemes.trim() === "") {
					parentPort.postMessage({ type: "result", id: msg.id, empty: true });
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
						voice: msg.voice as KokoroVoiceId,
						speed: msg.speed,
					});
					samplingRate = raw.sampling_rate;
					audios.push(raw.audio as Float32Array);
				}
				if (audios.length === 0) {
					parentPort.postMessage({ type: "result", id: msg.id, empty: true });
					return;
				}
				const totalLength = audios.reduce((n, a) => n + a.length, 0);
				const joined = new Float32Array(totalLength);
				let offset = 0;
				for (const a of audios) {
					joined.set(a, offset);
					offset += a.length;
				}
				parentPort.postMessage({
					type: "result",
					id: msg.id,
					audio: joined,
					samplingRate,
					synthMs: Math.round(performance.now() - startedAt),
				});
			} catch (e) {
				parentPort.postMessage({
					type: "result",
					id: msg.id,
					error: e instanceof Error ? e.message : String(e),
				});
			}
		})();
	}
});
