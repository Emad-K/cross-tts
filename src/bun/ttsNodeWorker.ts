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
	MAX_PHONEME_TOKENS,
	voiceLoader,
	type Kokoro,
} from "../mainview/features/reader/tts/kokoroModel";
import {
	KOKORO_REMOTE_PATH_TEMPLATE,
	kokoroVoiceOptions,
	voiceBinUrlFromHub,
} from "../mainview/features/reader/tts/kokoroVoices";
import type { TtsNodeEp, TtsNodeGenerateParams } from "../shared/ttsNodeRpc";
import { hubDiskCache } from "./hubDiskCache";

/**
 * Native TTS backend: an Electron utility process running Kokoro on
 * onnxruntime-node — on the CPU, or on NVIDIA CUDA / DirectML when the user
 * picked one (Settings → Voice → Advanced). fp32 on the CPU here is ~2.5×
 * faster than the renderer's WASM q8 path (native q8 is *slower* than fp32 —
 * dequant overhead dominates on the CPU EP).
 * Mirrors ttsWorker.ts (the renderer WASM/WebGPU worker): same phonemization,
 * same token-limit splitting, same result shape.
 */

const DTYPE = "fp32";

type GenerateJob = { type: "generate"; id: number } & TtsNodeGenerateParams;

type InitMessage = {
	type: "init";
	hubBaseUrl: string | null;
	/** Where the hub keeps the files it serves (see hubDiskCache). */
	hubCacheDir: string;
	numThreads: number;
	/** Execution provider to try; anything but "cpu" falls back to the CPU. */
	ep: TtsNodeEp;
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
let device: TtsNodeEp = "cpu";
let numThreads = 0;
let hubBaseUrl: string | null = null;

const loadVoice = voiceLoader(async (id) => {
	const res = await fetch(
		// Bytes always come from the pinned revision (hub, else huggingface.co).
		voiceBinUrlFromHub(hubBaseUrl ?? "https://huggingface.co/", id),
	);
	if (!res.ok) throw new Error(`Failed to fetch voice ${id}: ${res.status}`);
	return res.arrayBuffer();
});

/**
 * Session options per GPU provider. onnxruntime-node's binding only reads
 * `deviceId` from provider options, so GPU memory can't be capped; nodes the
 * provider can't run fall back to the CPU EP listed after it. DirectML
 * requires memory patterns off and sequential execution.
 */
const GPU_SESSION_OPTIONS = {
	cuda: { executionProviders: [{ name: "cuda", deviceId: 0 }, "cpu"] },
	dml: {
		executionProviders: [{ name: "dml" }, "cpu"],
		enableMemPattern: false,
		executionMode: "sequential",
	},
} as const;

const EP_LABEL = { cpu: "the CPU", cuda: "NVIDIA CUDA", dml: "DirectML" } as const;

function loadOn(target: TtsNodeEp): Promise<Kokoro> {
	return loadKokoro({
		dtype: DTYPE,
		device: "cpu",
		// The user's thread preference (Settings → Voice → Advanced) must reach the
		// native ORT session. 0 = auto (ORT's default: one per physical core).
		session_options: {
			...(numThreads > 0 ? { intraOpNumThreads: numThreads } : {}),
			...(target === "cpu" ? {} : GPU_SESSION_OPTIONS[target]),
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

/** The provider asked for when it loads, else the CPU (logging why). */
async function loadPreferred(ep: TtsNodeEp): Promise<Kokoro> {
	if (ep !== "cpu") {
		try {
			const model = await loadOn(ep);
			log("info", `Native TTS engine running on ${EP_LABEL[ep]}.`);
			return model;
		} catch (e) {
			log(
				"warn",
				`${EP_LABEL[ep]} couldn't start (${e instanceof Error ? e.message : String(e)}). Using the CPU.`,
			);
		}
	}
	return loadOn("cpu");
}

function load(init: InitMessage): Promise<Kokoro> {
	if (tts) return Promise.resolve(tts);
	if (!loadPromise) {
		hubBaseUrl = init.hubBaseUrl;
		numThreads = init.numThreads;
		env.remotePathTemplate = KOKORO_REMOTE_PATH_TEMPLATE;
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
		loadPromise = loadPreferred(init.ep)
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
 * One piece; a GPU run that fails (e.g. out of GPU memory) or returns
 * implausible audio switches the engine to the CPU for good and retries there.
 */
async function generatePiece(
	phonemes: string,
	voiceData: Float32Array,
	speed: number,
): Promise<Float32Array> {
	if (device === "cpu") return generatePhonemes(tts!, phonemes, voiceData, speed);
	try {
		const audio = await generatePhonemes(tts!, phonemes, voiceData, speed);
		if (!isPlausibleAudio(audio)) throw new Error("the audio came out wrong");
		return audio;
	} catch (e) {
		log(
			"warn",
			`${EP_LABEL[device]} run failed (${e instanceof Error ? e.message : String(e)}); switching the native engine to the CPU.`,
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
					device,
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
			msg.voice,
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
			device,
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
