/// <reference lib="webworker" />
import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import ortMjsUrl from "@transformers-dist/ort-wasm-simd-threaded.jsep.mjs?url";
import ortWasmUrl from "@transformers-dist/ort-wasm-simd-threaded.jsep.wasm?url";
import type { PronunciationRule } from "@shared/ttsTextRules";
import { isPlausibleAudio } from "./audioPlausibility";
import { phonemizeForKokoro } from "./kokoroPhonemize";
import { cacheVoiceBin } from "./prefetchKokoroAssets";
import { splitPhonemesForTokenLimit } from "./phonemeTokenSplit";
import { CANCELLED, SynthJobQueue } from "./synthJobQueue";
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
// Must be set before the first session is created.
const ortWasmEnv = env.backends?.onnx?.wasm;
if (ortWasmEnv) ortWasmEnv.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl };

let tts: KokoroTTS | null = null;
let loadPromise: Promise<KokoroTTS> | null = null;
/** ORT's WebGPU device once a webgpu model is loaded (null on wasm). */
let gpuDevice: GPUDevice | null = null;
/** Set when the GPU device was lost; every later run reports a GPU fault. */
let gpuLostReason: string | null = null;

/** Hook the device ORT created so a lost device fails runs instead of
 * silently producing garbage. */
async function watchGpuDevice(): Promise<void> {
	const webgpu = env.backends?.onnx?.webgpu as
		| { device?: GPUDevice | Promise<GPUDevice> }
		| undefined;
	const dev = await webgpu?.device;
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
	model: KokoroTTS,
	inputIds: Parameters<KokoroTTS["generate_from_ids"]>[0],
	voice: KokoroVoiceId,
	speed: number,
) {
	const dev = gpuDevice;
	if (!dev) return model.generate_from_ids(inputIds, { voice, speed });
	if (gpuLostReason) throw new Error(`gpu-fault: device lost (${gpuLostReason})`);
	dev.pushErrorScope("out-of-memory");
	dev.pushErrorScope("validation");
	let raw: Awaited<ReturnType<KokoroTTS["generate_from_ids"]>> | null = null;
	let runError: unknown = null;
	try {
		raw = await model.generate_from_ids(inputIds, { voice, speed });
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

let hubBaseUrl: string | null = null;
const cachedVoices = new Set<string>();

/**
 * kokoro-js reads voice files from the Cache API, else fetches them straight
 * from huggingface.co. Seed the cache from the local hub first so synthesis
 * works offline once the hub has the file. On failure kokoro-js falls back
 * to its own fetch, as before.
 */
async function ensureVoiceCached(id: string): Promise<void> {
	if (cachedVoices.has(id)) return;
	await cacheVoiceBin(id, hubBaseUrl)
		.then(() => cachedVoices.add(id))
		.catch(() => {});
}

function load(init: InitMessage): Promise<KokoroTTS> {
	if (tts) return Promise.resolve(tts);
	if (!loadPromise) {
		hubBaseUrl = init.hubBaseUrl;
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
			.then(async (model) => {
				if (init.device === "webgpu") await watchGpuDevice().catch(() => {});
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
		await ensureVoiceCached(msg.voice);
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
			if (await jobs.yieldAndCheckStale(msg)) return cancel();
			const { input_ids } = tts.tokenizer(piece, { truncation: true });
			const raw = await generatePiece(tts, input_ids, msg.voice, msg.speed);
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
		if (!isPlausibleAudio(joined)) {
			ctx.postMessage({ type: "result", id: msg.id, error: "bad-output" });
			return;
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
}
