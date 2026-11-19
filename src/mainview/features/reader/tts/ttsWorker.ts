/// <reference lib="webworker" />
import { env, type DataType } from "@huggingface/transformers";
import ortMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import type { PronunciationRule } from "@shared/ttsTextRules";
import { isPlausibleAudio } from "./audioPlausibility";
import { phonemizeForKokoro } from "./kokoroPhonemize";
import {
	generatePhonemes,
	KOKORO_SAMPLE_RATE,
	loadKokoro,
	voiceLoader,
	type Kokoro,
} from "./kokoroModel";
import { cacheVoiceBin } from "./prefetchKokoroAssets";
import { splitPhonemesForTokenLimit } from "./phonemeTokenSplit";
import { CANCELLED, SynthJobQueue } from "./synthJobQueue";
import {
	KOKORO_REMOTE_PATH_TEMPLATE,
	kokoroVoiceOptions,
	type KokoroVoiceId,
} from "./kokoroVoices";

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
type KokoroDtype = DataType;

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
	/** Playback epoch; older-epoch jobs are cancelled (see SynthJobQueue). */
	epoch?: number;
};

type InMessage = InitMessage | GenerateMessage;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Load the ONNX Runtime wasm binary and its JS glue from the app bundle. Left
// unset, transformers.js points ORT at cdn.jsdelivr.net, so the GPU/in-app CPU
// path wasn't offline. The glue (.mjs) must be its own file: with only the
// binary set, ORT uses the glue embedded in its bundle and spawns its
// pthread workers from import.meta.url, i.e. this worker script, whose
// onmessage then swallows the pthread start-up and multi-threaded wasm hangs.
// transformers.js 4 imports onnxruntime-web/webgpu, whose WebGPU EP and CPU
// path both run on the "asyncify" build. Must be set before the first session.
const ortWasmEnv = env.backends?.onnx?.wasm;
if (ortWasmEnv) ortWasmEnv.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl };
// Its wasm cache would re-serve the glue as a blob: URL, which the CSP
// (script-src 'self') refuses; the files are local anyway.
env.useWasmCache = false;

let tts: Kokoro | null = null;
let loadPromise: Promise<Kokoro> | null = null;
/** ORT's WebGPU device once a webgpu model is loaded (null on wasm). */
let gpuDevice: GPUDevice | null = null;
/** Set when the GPU device was lost; every later run reports a GPU fault. */
let gpuLostReason: string | null = null;

/** Hook the device ORT created so a lost device fails runs instead of
 * silently producing garbage. */
async function watchGpuDevice(own?: GPUDevice): Promise<void> {
	const webgpu = env.backends?.onnx?.webgpu as
		| { device?: GPUDevice | Promise<GPUDevice> }
		| undefined;
	const dev = own ?? (await webgpu?.device);
	if (!dev) return;
	gpuDevice = dev;
	void dev.lost.then((info) => {
		gpuLostReason = info.message || info.reason || "unknown";
	});
}

/**
 * One model run, with GPU errors made visible. ORT-web only logs validation
 * errors and drops out-of-memory ones, and a failed buffer allocation can
 * leave the run "succeeding" on stale pooled buffers — finite but wrong audio
 * (the "odd voice" on Linux GPUs with no free VRAM). Error scopes around the
 * run catch both; runs are serialized, so the scopes never overlap.
 */
async function generatePiece(
	model: Kokoro,
	phonemes: string,
	voiceData: Float32Array,
	speed: number,
): Promise<Float32Array> {
	const dev = gpuDevice;
	if (!dev) return generatePhonemes(model, phonemes, voiceData, speed);
	if (gpuLostReason) throw new Error(`gpu-fault: device lost (${gpuLostReason})`);
	dev.pushErrorScope("out-of-memory");
	dev.pushErrorScope("validation");
	let raw: Float32Array | null = null;
	let runError: unknown = null;
	try {
		raw = await generatePhonemes(model, phonemes, voiceData, speed);
	} catch (e) {
		runError = e;
	}
	const [validation, oom] = await Promise.all([
		dev.popErrorScope().catch(() => null),
		dev.popErrorScope().catch(() => null),
	]);
	if (runError) throw runError;
	const fault = oom ?? validation;
	if (fault) throw new Error(`gpu-fault: ${fault.message}`);
	if (gpuLostReason) throw new Error(`gpu-fault: device lost (${gpuLostReason})`);
	return raw!;
}

/** Limits and features ORT asks for when it creates its own device. */
const GPU_LIMITS = [
	"maxBufferSize",
	"maxStorageBufferBindingSize",
	"maxComputeWorkgroupStorageSize",
	"maxComputeWorkgroupsPerDimension",
	"maxComputeInvocationsPerWorkgroup",
	"maxComputeWorkgroupSizeX",
	"maxComputeWorkgroupSizeY",
	"maxComputeWorkgroupSizeZ",
] as const;
const GPU_FEATURES = ["shader-f16", "timestamp-query", "subgroups"];

async function requestGpuDevice(power: GpuPower): Promise<GPUDevice | undefined> {
	// WebGPU can't pick a GPU by name — only a power hint, which on multi-GPU
	// machines selects the dedicated (high-performance) vs integrated
	// (low-power) adapter. ORT 1.31's native WebGPU EP ignores
	// env.webgpu.adapter/powerPreference and only takes a device through the
	// EP options, so create one on the chosen adapter ourselves.
	if (power === "auto") return undefined;
	try {
		if (typeof navigator === "undefined" || !navigator.gpu) return undefined;
		const adapter = await navigator.gpu.requestAdapter({
			powerPreference: power,
		});
		if (!adapter) return undefined;
		const requiredLimits: Record<string, number> = {};
		for (const k of GPU_LIMITS) requiredLimits[k] = adapter.limits[k];
		return await adapter.requestDevice({
			requiredLimits,
			requiredFeatures: GPU_FEATURES.filter((f) =>
				adapter.features.has(f),
			) as GPUFeatureName[],
		});
	} catch {
		return undefined; // Fall back to ORT's default adapter selection.
	}
}

let hubBaseUrl: string | null = null;

/** Voice style vectors: Cache API first, else the local hub (else HF). */
const loadVoice = voiceLoader((id) => cacheVoiceBin(id, hubBaseUrl));

function load(init: InitMessage): Promise<Kokoro> {
	if (tts) return Promise.resolve(tts);
	if (!loadPromise) {
		hubBaseUrl = init.hubBaseUrl;
		let ownDevice: GPUDevice | undefined;
		env.remotePathTemplate = KOKORO_REMOTE_PATH_TEMPLATE;
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
				? requestGpuDevice(init.gpuPower)
				: Promise.resolve(undefined)
		)
			.then((device) => {
				ownDevice = device;
				return loadKokoro({
					dtype: init.dtype,
					device: init.device,
					...(device && {
						session_options: {
							executionProviders: [{ name: "webgpu", device }],
						},
					}),
					progress_callback: (info) => {
						if (info.status === "progress") {
							ctx.postMessage({ type: "progress", value: info.progress / 100 });
						}
					},
				});
			})
			.then(async (model) => {
				if (init.device === "webgpu") {
					await watchGpuDevice(ownDevice).catch(() => {});
				}
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

ctx.onmessage = (event: MessageEvent<InMessage>) => {
	const msg = event.data;

	if (msg.type === "init") {
		const startedAt = performance.now();
		void load(msg)
			.then(() => {
				ctx.postMessage({
					type: "ready",
					voices: kokoroVoiceOptions(),
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
		jobs.push(msg);
	}
};

/**
 * Generate jobs run one at a time, in arrival order: GPU error scopes must
 * wrap exactly one run, and the queue drops jobs a seek made stale.
 */
const jobs = new SynthJobQueue<GenerateMessage>((msg) => runGenerate(msg));

async function runGenerate(msg: GenerateMessage): Promise<void> {
	const startedAt = performance.now();
	const cancel = () =>
		ctx.postMessage({ type: "result", id: msg.id, error: CANCELLED });
	try {
		if (jobs.isStale(msg)) return cancel();
		if (!tts) {
			ctx.postMessage({
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
			ctx.postMessage({ type: "result", id: msg.id, empty: true });
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
			audios.push(await generatePiece(tts, piece, voiceData, msg.speed));
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
		if (!isPlausibleAudio(joined)) {
			ctx.postMessage({ type: "result", id: msg.id, error: "bad-output" });
			return;
		}
		ctx.postMessage(
			{
				type: "result",
				id: msg.id,
				audio: joined,
				samplingRate: KOKORO_SAMPLE_RATE,
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
}
