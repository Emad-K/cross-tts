import { env } from "@huggingface/transformers";
import { isPlausibleAudio } from "../mainview/features/reader/tts/audioPlausibility";
import { phonemizeForKokoro } from "../mainview/features/reader/tts/kokoroPhonemize";
import { splitPhonemesForTokenLimit } from "../mainview/features/reader/tts/phonemeTokenSplit";
import {
	CANCELLED,
	SynthJobQueue,
} from "../mainview/features/reader/tts/synthJobQueue";
import {
	generatePhonemes,
	KOKORO_SAMPLE_RATE,
	loadKokoro,
	voiceLoader,
	type Kokoro,
} from "../mainview/features/reader/tts/kokoroModel";
import {
	kokoroVoiceOptions,
	voiceBinUrl,
	voiceBinUrlFromHub,
} from "../mainview/features/reader/tts/kokoroVoices";
import type { KokoroVoiceId } from "../mainview/features/reader/tts/kokoroVoices";
import type { TtsNodeGenerateParams } from "../shared/ttsNodeRpc";
import { hubDiskCache } from "./hubDiskCache";

/**
 * Native CPU TTS backend: an Electron utility process running Kokoro on
 * onnxruntime-node. fp32 here is ~2.5× faster than the renderer's WASM q8
 * path (native q8 is *slower* than fp32 — dequant overhead dominates on the
 * CPU EP).
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

type GenerateJob = { type: "generate"; id: number } & TtsNodeGenerateParams;

type InitMessage = {
	type: "init";
	hubBaseUrl: string | null;
	/** Where the hub keeps the files it serves (see hubDiskCache). */
	hubCacheDir: string;
	numThreads: number;
};

type InMessage = InitMessage | GenerateJob;

const parentPort = process.parentPort;

let tts: Kokoro | null = null;
let loadPromise: Promise<Kokoro> | null = null;
let numThreads = 0;
let hubBaseUrl: string | null = null;

const loadVoice = voiceLoader(async (id) => {
	const res = await fetch(
		hubBaseUrl ? voiceBinUrlFromHub(hubBaseUrl, id) : voiceBinUrl(id),
	);
	if (!res.ok) throw new Error(`Failed to fetch voice ${id}: ${res.status}`);
	return res.arrayBuffer();
});

function loadOnCpu(): Promise<Kokoro> {
	return loadKokoro({
		dtype: DTYPE,
		device: "cpu",
		// The user's thread preference (Settings → Performance) must reach the
		// native ORT session. 0 = auto (ORT's default: one per physical core).
		session_options: numThreads > 0 ? { intraOpNumThreads: numThreads } : {},
		progress_callback: (info) => {
			if (info.status === "progress") {
				parentPort.postMessage({
					type: "progress",
					value: info.progress / 100,
				});
			}
		},
	});
}

function load(init: InitMessage): Promise<Kokoro> {
	if (tts) return Promise.resolve(tts);
	if (!loadPromise) {
		hubBaseUrl = init.hubBaseUrl;
		numThreads = init.numThreads;
		if (init.hubBaseUrl) {
			// Fetch through the main process's caching hub proxy so the native and
			// renderer backends share one on-disk model cache; skip transformers.js's
			// own FS cache to avoid storing the weights twice.
			env.remoteHost = init.hubBaseUrl;
			env.useFSCache = false;
			env.useCustomCache = true;
			env.customCache = hubDiskCache(init.hubBaseUrl, init.hubCacheDir);
			env.allowLocalModels = false;
		}
		loadPromise = loadOnCpu()
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

parentPort.on("message", (event) => {
	const msg = event.data as InMessage;

	if (msg.type === "init") {
		const startedAt = performance.now();
		void load(msg)
			.then(() => {
				parentPort.postMessage({
					type: "ready",
					voices: kokoroVoiceOptions(),
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
		jobs.push(msg);
	}
});

/**
 * onnxruntime-node runs each inference synchronously, blocking this process's
 * event loop, so messages that arrive meanwhile (a newer playback epoch) are
 * read only when we yield. A timer and then an immediate make sure a full
 * loop turn, including I/O polling, happens before the next run.
 */
const yieldToMessages = () =>
	new Promise<void>((r) => setTimeout(r, 0)).then(
		() => new Promise<void>((r) => setImmediate(r)),
	);

/** Generate jobs run one at a time; stale playback jobs are dropped. */
const jobs = new SynthJobQueue<GenerateJob>(
	(msg) => runGenerate(msg),
	yieldToMessages,
);

async function runGenerate(msg: GenerateJob): Promise<void> {
	const startedAt = performance.now();
	const cancel = () =>
		parentPort.postMessage({ type: "result", id: msg.id, error: CANCELLED });
	try {
		if (jobs.isStale(msg)) return cancel();
		if (!tts) {
			parentPort.postMessage({
				type: "result",
				id: msg.id,
				error: "Model not loaded",
			});
			return;
		}
		const voiceData = await loadVoice(msg.voice);
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
		for (const piece of pieces) {
			if (piece.trim() === "") continue;
			if (await jobs.yieldAndCheckStale(msg)) return cancel();
			audios.push(await generatePhonemes(tts, piece, voiceData, msg.speed));
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
		if (!isPlausibleAudio(joined)) {
			parentPort.postMessage({ type: "result", id: msg.id, error: "bad-output" });
			return;
		}
		parentPort.postMessage({
			type: "result",
			id: msg.id,
			audio: joined,
			samplingRate: KOKORO_SAMPLE_RATE,
			synthMs: Math.round(performance.now() - startedAt),
		});
	} catch (e) {
		parentPort.postMessage({
			type: "result",
			id: msg.id,
			error: e instanceof Error ? e.message : String(e),
		});
	}
}
