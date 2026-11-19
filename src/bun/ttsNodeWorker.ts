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
import { cudaUnavailableReason, ortBindingDir } from "./cudaSupport";
import { hubDiskCache } from "./hubDiskCache";

/**
 * Native CPU TTS backend: an Electron utility process running Kokoro on
 * onnxruntime-node (optionally on the CUDA EP, opt-in). fp32 here is ~2.5×
 * faster than the renderer's WASM q8 path (native q8 is *slower* than fp32 —
 * dequant overhead dominates on the CPU EP).
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
	/** User opted in to the CUDA EP (Settings → Performance). */
	cuda: boolean;
};

type InMessage = InitMessage | GenerateJob;

const parentPort = process.parentPort;

/** Forwarded to the app log by ttsNode.ts. */
function log(level: "info" | "warn", message: string): void {
	parentPort.postMessage({ type: "log", level, message });
}

let tts: Kokoro | null = null;
let loadPromise: Promise<Kokoro> | null = null;
/** Execution provider of the loaded model. */
let device: "cpu" | "cuda" = "cpu";
let numThreads = 0;
let hubBaseUrl: string | null = null;

const loadVoice = voiceLoader(async (id) => {
	const res = await fetch(
		hubBaseUrl ? voiceBinUrlFromHub(hubBaseUrl, id) : voiceBinUrl(id),
	);
	if (!res.ok) throw new Error(`Failed to fetch voice ${id}: ${res.status}`);
	return res.arrayBuffer();
});

function loadOn(target: "cpu" | "cuda"): Promise<Kokoro> {
	return loadKokoro({
		dtype: DTYPE,
		device: "cpu",
		// The user's thread preference (Settings → Performance) must reach the
		// native ORT session. 0 = auto (ORT's default: one per physical core).
		// CUDA: onnxruntime-node's binding only reads `deviceId` from provider
		// options, so gpu_mem_limit / arena_extend_strategy can't be set here;
		// nodes CUDA can't run fall back to the CPU EP listed after it.
		session_options: {
			...(numThreads > 0 ? { intraOpNumThreads: numThreads } : {}),
			...(target === "cuda"
				? { executionProviders: [{ name: "cuda", deviceId: 0 }, "cpu"] }
				: {}),
		},
		progress_callback: (info) => {
			if (info.status === "progress") {
				parentPort.postMessage({
					type: "progress",
					value: info.progress / 100,
				});
			}
		},
	}).then((model) => {
		device = target;
		return model;
	});
}

/** CUDA when asked for and loadable, else CPU (with a log line saying why). */
async function loadPreferred(cuda: boolean): Promise<Kokoro> {
	if (cuda) {
		let reason: string | null;
		try {
			reason = cudaUnavailableReason(
				process.platform,
				process.arch,
				ortBindingDir(),
			);
		} catch (e) {
			reason = `ONNX Runtime binding not found (${e instanceof Error ? e.message : String(e)})`;
		}
		if (reason) {
			log("warn", `CUDA unavailable: ${reason}. Using the CPU.`);
		} else {
			try {
				const model = await loadOn("cuda");
				log("info", "Native TTS engine running on CUDA.");
				return model;
			} catch (e) {
				log(
					"warn",
					`CUDA session failed (${e instanceof Error ? e.message : String(e)}); is CUDA 12 + cuDNN 9 installed? Using the CPU.`,
				);
			}
		}
	}
	return loadOn("cpu");
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
		loadPromise = loadPreferred(init.cuda)
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

/**
 * One piece; a failed CUDA run (e.g. out of GPU memory) switches the engine
 * to CPU for good and retries there.
 */
async function generatePiece(
	phonemes: string,
	voiceData: Float32Array,
	speed: number,
): Promise<Float32Array> {
	try {
		return await generatePhonemes(tts!, phonemes, voiceData, speed);
	} catch (e) {
		if (device !== "cuda") throw e;
		log(
			"warn",
			`CUDA run failed (${e instanceof Error ? e.message : String(e)}); switching the native engine to CPU.`,
		);
		const stale = tts;
		tts = await loadOn("cpu");
		loadPromise = Promise.resolve(tts);
		void stale?.model.dispose().catch(() => {});
		return generatePhonemes(tts, phonemes, voiceData, speed);
	}
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
			audios.push(await generatePiece(piece, voiceData, msg.speed));
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
