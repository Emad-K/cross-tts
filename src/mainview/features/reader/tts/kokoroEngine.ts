import {
	getKokoroHubBaseUrl,
	isDesktopApp,
	getModelStatus,
	onTtsNodeProgress,
	ttsNodeGenerate,
	ttsNodeInit,
	ttsNodeStop,
} from "@/lib/desktopBridge";
import { logError, logInfo, logWarn } from "../logging";
import { useAppSettingsStore } from "../settings/appSettingsStore";
import { getTtsRulesForEngine } from "../ttsRules/ttsRulesStore";
import type { GpuPowerPreference } from "@shared/appConfig";
import type { TtsNodeEp } from "@shared/ttsNodeRpc";
import { announceFallback, loadPlan } from "./backendChoice";
import { describeAdapter, softwareAdapterReason } from "./gpuAdapter";
import { getKokoroHubBaseUrlSync, setKokoroHubBaseUrl } from "./kokoroHubConfig";
import { kokoroVoiceOptions } from "./kokoroVoices";
import { prefetchAllVoiceBins } from "./prefetchKokoroAssets";
import type {
	TtsBackendPrefs,
	TtsEngine,
	TtsSynthOptions,
} from "./ttsEngineTypes";
import { useTtsStore } from "./ttsStore";

/**
 * Kokoro-82M behind the TtsEngine interface. Backends, in the default
 * ("auto") order: WebGPU renderer worker (ttsWorker.ts, fp32) → native
 * onnxruntime-node utility process (src/bun/ttsNodeWorker.ts) → WASM renderer
 * worker (q8). Other backend choices reorder this (backendChoice.ts); the
 * native process can also run on NVIDIA CUDA or DirectML when picked.
 * Both workers phonemize, split phonemes at Kokoro's token limit, and check
 * the audio is plausible.
 */

type KokoroDevice = "webgpu" | "wasm";
type KokoroDtype = "fp32" | "fp16" | "q8";
/**
 * Where synthesis actually runs: the renderer worker (webgpu/wasm) or the
 * native onnxruntime-node utility process ("node" — the preferred CPU path,
 * ~2.5× faster than wasm; see src/bun/ttsNodeWorker.ts).
 */
type KokoroBackend = KokoroDevice | "node";

/** Result of a single chunk synthesis request to a backend. */
type GenerateResult =
	| { kind: "audio"; audio: Float32Array; samplingRate: number }
	| { kind: "empty" }
	| { kind: "error"; message: string };

let hubEnvPromise: Promise<void> | null = null;

async function configureKokoroHubEnv(): Promise<void> {
	const base = await getKokoroHubBaseUrl();
	// The desktop app never goes online behind the hub's back (no sha256
	// checks, no disk cache); only a plain browser build uses huggingface.co.
	if (!base && isDesktopApp()) {
		throw new Error("The local model server isn't running.");
	}
	setKokoroHubBaseUrl(base);
}

function ensureKokoroHubEnv(): Promise<void> {
	if (!hubEnvPromise) {
		hubEnvPromise = configureKokoroHubEnv();
		// A failed lookup is retried on the next load.
		hubEnvPromise.catch(() => {
			hubEnvPromise = null;
		});
	}
	return hubEnvPromise;
}

/**
 * Log the CPU runtime state once per load (threading needs SharedArrayBuffer,
 * enabled by the main process via the Chromium "SharedArrayBuffer" feature).
 */
function logCpuThreads(threads: number): number {
	const hasSab = typeof SharedArrayBuffer !== "undefined";
	logInfo(
		`CPU synthesis: ${threads} thread(s) requested, worker on ` +
			`(SharedArrayBuffer=${hasSab}).`,
		{ source: "models" },
	);
	if (!hasSab) {
		logWarn(
			"No SharedArrayBuffer — speech on the processor runs single-threaded (slower). If you have a graphics card, pick it in Settings → Voice → Advanced.",
			{ source: "models" },
		);
	}
	return threads;
}

// --- TTS worker ---------------------------------------------------------------
// All model loading and inference happens off the main thread so a slow
// synthesis never freezes the UI.

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let reqSeq = 0;
const pending = new Map<number, (result: GenerateResult) => void>();
let onWorkerReady: (() => void) | null = null;
let onWorkerInitError: ((err: Error) => void) | null = null;
/** Model load time reported by the worker (ms), for the "ready" log line. */
let lastLoadMs = 0;
/** Log the first synthesis duration after each (re)load to explain warm-up. */
let loggedFirstSynth = false;
/** Backend of the currently loaded model, or null when nothing is loaded. */
let activeDevice: KokoroBackend | null = null;
/** Execution provider the native process runs on (when activeDevice is "node"). */
let nodeDevice: TtsNodeEp = "cpu";
/** Weights precision of the loaded model (fp32 on the native backend). */
let activeDtype: KokoroDtype = "fp32";
/**
 * Bumped by every teardown. A load started under an older generation was
 * superseded by a reset and must not mark the engine ready or tear down the
 * newer load.
 */
let loadGen = 0;

const ENGINE_RESET = "TTS engine reset";
const ENGINE_TIMEOUT = "TTS engine timed out";
/** The native CPU process died; reloading starts a fresh one. */
const NODE_DEAD_RE = /Native TTS (engine not running|process exited)/;
/** Worker requests that get no reply in this long are treated as a hung
 * engine. Counted from the request, so it covers the queue ahead of it. */
const WATCHDOG_BASE_MS = 60_000;
const WATCHDOG_MS_PER_CHAR = 500;
/** Characters of worker requests still awaiting a reply (watchdog budget). */
let queuedChars = 0;
/**
 * Set when a WebGPU run failed (GPU fault, implausible audio, crash, hang).
 * Loads then skip the GPU until the engine is reset from Settings, so a GPU
 * without free VRAM degrades to CPU audio instead of odd-sounding audio.
 */
let gpuFailed = false;

function spawnWorker(): Worker {
	const w = new Worker(new URL("./ttsWorker.ts", import.meta.url), {
		type: "module",
	});
	w.onmessage = (event: MessageEvent) => {
		const msg = event.data;
		switch (msg?.type) {
			case "progress":
				useTtsStore.getState().setModelProgress(msg.value);
				break;
			case "ready":
				lastLoadMs = typeof msg.loadMs === "number" ? msg.loadMs : 0;
				onWorkerReady?.();
				break;
			case "initError":
				onWorkerInitError?.(new Error(msg.message));
				break;
			case "result": {
				const resolve = pending.get(msg.id);
				if (!resolve) break;
				pending.delete(msg.id);
				if (msg.error) resolve({ kind: "error", message: msg.error });
				else if (msg.empty) resolve({ kind: "empty" });
				else {
					if (!loggedFirstSynth && typeof msg.synthMs === "number") {
						loggedFirstSynth = true;
						logInfo(
							`First sentence synthesized in ${(msg.synthMs / 1000).toFixed(1)}s ` +
								"(later sentences are prefetched while one plays).",
							{ source: "tts" },
						);
					}
					resolve({
						kind: "audio",
						audio: msg.audio,
						samplingRate: msg.samplingRate,
					});
				}
				break;
			}
		}
	};
	w.onerror = (e) => {
		if (worker !== w) return;
		const message = e.message || "TTS worker crashed";
		if (!activeDevice) {
			onWorkerInitError?.(new Error(message));
			return;
		}
		// Crashed after load: fail what's pending instead of buffering forever;
		// the next request reloads.
		teardownWorker(`TTS worker crashed: ${message}`);
	};
	return w;
}

function teardownWorker(reason = ENGINE_RESET): void {
	loadGen++;
	// Unconditionally: a native load may still be in flight (activeDevice is
	// only set once it finishes), and its cached init would ignore new settings.
	void ttsNodeStop();
	// Settle a load in progress so its awaiters (playback, voice download,
	// export) don't hang forever.
	onWorkerInitError?.(new Error(reason));
	worker?.terminate();
	worker = null;
	workerReady = null;
	activeDevice = null;
	onWorkerReady = null;
	onWorkerInitError = null;
	useTtsStore.getState().setModelPhase("idle");
	const toFail = [...pending.values()];
	pending.clear();
	for (const resolve of toFail) {
		resolve({ kind: "error", message: reason });
	}
	// Audio differs by device (q8 CPU vs fp32 GPU) and reload, so don't keep
	// buffers across a teardown.
	kokoroEngine.onReset?.();
}

/** Start the worker and load the model with the given device, once. */
function initWorker(
	device: KokoroDevice,
	dtype: KokoroDtype,
	prefs: TtsBackendPrefs,
): Promise<void> {
	const base = getKokoroHubBaseUrlSync();
	const numThreads = device === "wasm" ? logCpuThreads(prefs.cpuThreads) : 1;
	loggedFirstSynth = false;
	worker = spawnWorker();
	const ready = new Promise<void>((resolve, reject) => {
		onWorkerReady = resolve;
		onWorkerInitError = reject;
	});
	worker.postMessage({
		type: "init",
		hubBaseUrl: base,
		device,
		dtype,
		numThreads,
		gpuPower: prefs.gpuPower,
	});
	return ready;
}

let loggedAdapter = false;

/**
 * Probe whether a usable WebGPU adapter exists (on the preferred GPU), and
 * record it for the UI. Software adapters count as none. `f16`: the adapter
 * has the shader-f16 feature fp16 weights need.
 */
async function detectWebgpu(
	power: GpuPowerPreference,
): Promise<{ available: boolean; f16: boolean }> {
	let available = false;
	let f16 = false;
	try {
		if (typeof navigator !== "undefined" && navigator.gpu) {
			const adapter = await navigator.gpu.requestAdapter(
				power === "auto" ? undefined : { powerPreference: power },
			);
			if (adapter) {
				const software = softwareAdapterReason(adapter);
				if (!loggedAdapter) {
					loggedAdapter = true;
					logInfo(
						`WebGPU adapter: ${describeAdapter(adapter.info)}` +
							(software ? ` (software: ${software}; using the CPU instead).` : "."),
						{ source: "models" },
					);
				}
				available = !software;
				f16 = adapter.features.has("shader-f16");
			}
		}
	} catch {
		available = false;
	}
	useAppSettingsStore.getState().setWebgpuAvailable(available);
	return { available, f16 };
}

/**
 * Kokoro-js `device: "webgpu"` uses the renderer's standard WebGPU API
 * (`navigator.gpu` + ONNX Runtime WebGPU EP), available in the Electron
 * (Chromium) renderer process.
 *
 * The CPU and GPU paths load *different* model weights: WebGPU needs full
 * precision (`dtype: "fp32"` — q8 on WebGPU gives garbage audio), while the CPU
 * (wasm) path uses the smaller quantized `q8` weights. GPU is on by default and
 * used whenever the preference is enabled AND an adapter is present; otherwise
 * we fall back to CPU. Half-precision `fp16` GPU weights are opt-in (Settings)
 * and need the adapter's shader-f16 feature.
 */
/** Weights to load on WebGPU, or null when there is no usable GPU for it. */
async function resolveGpuDtype(
	prefs: TtsBackendPrefs,
): Promise<"fp32" | "fp16" | null> {
	if (gpuFailed) return null;
	const gpu = await detectWebgpu(prefs.gpuPower);
	if (!gpu.available) return null;
	if (!prefs.gpuFp16) return "fp32";
	if (!gpu.f16) {
		logInfo("This GPU lacks 16-bit shaders (shader-f16); using the fp32 model.", {
			source: "models",
		});
		return "fp32";
	}
	// Never fetch fp16 implicitly: the app must stay offline once its models
	// are downloaded, so it is only used after an explicit download.
	if (!(await getModelStatus().catch(() => null))?.fp16.present) {
		logInfo(
			"The smaller graphics-card model isn't downloaded (Settings → Voice → Advanced); using the full model.",
			{ source: "models" },
		);
		return "fp32";
	}
	return "fp16";
}

/** Synthesize one chunk on the native (onnxruntime-node) CPU backend. */
async function requestGenerateNode(
	text: string,
	voice: string,
	speed: number,
	epoch: number | undefined,
): Promise<GenerateResult> {
	const { pronunciationRules } = getTtsRulesForEngine();
	const result = await ttsNodeGenerate({
		text,
		voice,
		speed,
		pronunciationRules,
		epoch,
	});
	if (!result) {
		return { kind: "error", message: "Native TTS bridge unavailable" };
	}
	if (result.kind === "audio") {
		if (!loggedFirstSynth) {
			loggedFirstSynth = true;
			logInfo(
				`First sentence synthesized in ${(result.synthMs / 1000).toFixed(1)}s ` +
					"(later sentences are prefetched while one plays).",
				{ source: "tts" },
			);
		}
		// A GPU run failed in the native process (e.g. out of GPU memory) and
		// it moved to the CPU for good: say so once.
		if (result.device !== nodeDevice && activeDevice === "node") {
			announceFallback(kokoroEngine.id, nodeDevice, result.device);
			nodeDevice = result.device;
		}
		return {
			kind: "audio",
			audio: result.audio,
			samplingRate: result.samplingRate,
		};
	}
	return result;
}

/**
 * Ask the active backend to synthesize one chunk's audio. `epoch` marks a
 * playback request the worker may cancel once a newer epoch arrives.
 */
function requestGenerate(
	text: string,
	voice: string,
	speed: number,
	epoch?: number,
): Promise<GenerateResult> {
	if (activeDevice === "node") {
		return requestGenerateNode(text, voice, speed, epoch);
	}
	const w = worker;
	if (!w) return Promise.resolve({ kind: "error", message: "Engine not ready" });
	const { pronunciationRules } = getTtsRulesForEngine();
	const id = ++reqSeq;
	return new Promise<GenerateResult>((resolve) => {
		const chars = text.length;
		queuedChars += chars;
		// A stalled GPU or a silently killed worker never replies; without this
		// the loop would sit in "buffering" for good.
		const timer = setTimeout(
			() => {
				const finish = pending.get(id);
				if (!finish) return;
				pending.delete(id);
				finish({ kind: "error", message: ENGINE_TIMEOUT });
				if (worker === w) teardownWorker(ENGINE_TIMEOUT);
			},
			WATCHDOG_BASE_MS + WATCHDOG_MS_PER_CHAR * queuedChars,
		);
		pending.set(id, (result) => {
			clearTimeout(timer);
			queuedChars -= chars;
			resolve(result);
		});
		w.postMessage({
			type: "generate",
			id,
			text,
			voice,
			speed,
			pronunciationRules,
			epoch,
		});
	});
}

/**
 * Load the model in the native onnxruntime-node utility process, on execution
 * provider `ep` (on the CPU it is ~2.5× faster than the wasm worker — fp32
 * native measures 3.5–4× realtime where wasm q8 hovers near 1×). A GPU
 * provider that can't start leaves the process on the CPU (see nodeDevice).
 * Returns null when the bridge is unavailable (web build) or the process
 * failed, so the caller can fall back.
 */
async function initNodeBackend(ep: TtsNodeEp): Promise<"node" | null> {
	const { setModelProgress } = useTtsStore.getState();
	const unsubscribe = onTtsNodeProgress((value) => setModelProgress(value));
	try {
		logInfo(
			`Loading voice model (${ep === "cpu" ? "CPU" : ep.toUpperCase()}, native)…`,
			{ source: "models" },
		);
		loggedFirstSynth = false;
		const result = await ttsNodeInit("kokoro", ep);
		if (!result) return null;
		if (!result.ok) {
			logWarn(
				"Native CPU synthesis failed to start; falling back to in-app CPU.",
				{ source: "models", detail: result.error },
			);
			return null;
		}
		lastLoadMs = result.loadMs;
		nodeDevice = result.device;
		return "node";
	} catch (e) {
		logWarn(
			"Native CPU synthesis failed to start; falling back to in-app CPU.",
			{ source: "models", detail: e instanceof Error ? e.message : String(e) },
		);
		return null;
	} finally {
		unsubscribe();
	}
}

/**
 * Ensure a TTS backend is up and the model is loaded. The order comes from
 * the backend choice (loadPlan; by default WebGPU → native CPU utility
 * process → wasm worker). Each step falls through to the next on failure so
 * playback works.
 */
function ensureKokoroLoaded(prefs: TtsBackendPrefs): Promise<void> {
	if (worker && workerReady) return workerReady;
	if (!workerReady) {
		const { setModelPhase, setModelProgress } = useTtsStore.getState();
		setModelPhase("loading");
		setModelProgress(0);

		const gen = loadGen;
		/** Abort this load if a reset superseded it while it awaited. */
		const checkCurrent = () => {
			if (gen !== loadGen) throw new Error(ENGINE_RESET);
		};
		workerReady = (async () => {
			await ensureKokoroHubEnv();
			checkCurrent();
			let backend: KokoroBackend | null = null;
			let loadedDtype: KokoroDtype = "fp32";
			const plan = loadPlan(kokoroEngine.id, prefs.backend);
			for (const step of prefs.noFallback ? plan.slice(0, 1) : plan) {
				if (step === "webgpu") {
					const dtype = await resolveGpuDtype(prefs);
					checkCurrent();
					if (!dtype) continue;
					logInfo(`Loading voice model (GPU, ${dtype})…`, { source: "models" });
					try {
						try {
							await initWorker("webgpu", dtype, prefs);
							loadedDtype = dtype;
						} catch (e) {
							if (dtype !== "fp16") throw e;
							checkCurrent();
							// Opt-in fp16 may lack kernels or shader-f16 on ORT's device.
							logWarn("The half-precision GPU model failed to load; trying fp32.", {
								source: "models",
								detail: e instanceof Error ? e.message : String(e),
							});
							worker?.terminate();
							worker = null;
							await initWorker("webgpu", "fp32", prefs);
						}
						backend = "webgpu";
					} catch (e) {
						checkCurrent();
						// GPU failed — fall through to the CPU paths so the app still speaks.
						logWarn("GPU synthesis failed to initialize; falling back to CPU.", {
							source: "models",
							detail: e instanceof Error ? e.message : String(e),
						});
						worker?.terminate();
						worker = null;
					}
				} else if (step === "wasm") {
					logInfo("Loading voice model (CPU)…", { source: "models" });
					await initWorker("wasm", "q8", prefs);
					checkCurrent();
					backend = "wasm";
					loadedDtype = "q8";
				} else {
					backend = await initNodeBackend(step === "cpu" ? "cpu" : step);
					checkCurrent();
				}
				if (backend) break;
			}
			if (!backend) throw new Error("No speech backend could start.");
			activeDevice = backend;
			activeDtype = loadedDtype;
			setModelPhase("ready");
			setModelProgress(1);
			const label =
				backend === "webgpu"
					? "GPU"
					: backend === "node"
						? nodeDevice === "cpu"
							? "CPU, native"
							: `${nodeDevice.toUpperCase()}, native`
						: "CPU, in-app";
			logInfo(
				`Voice model ready (${label}) — ` +
					`loaded in ${(lastLoadMs / 1000).toFixed(1)}s.`,
				{ source: "models" },
			);
			if (!prefs.noFallback) {
				announceFallback(kokoroEngine.id, prefs.backend, runningOn()!);
			}
		})().catch((e: unknown) => {
			// Superseded by a reset: the newer load owns the engine state now.
			if (gen !== loadGen) throw e;
			const msg = e instanceof Error ? e.message : String(e);
			teardownWorker();
			setModelPhase("error", msg);
			logError("Couldn't load the voice model.", {
				source: "models",
				detail: msg,
			});
			throw e;
		});
	}
	return workerReady;
}

/**
 * - WebGPU error: switch to CPU. A fresh worker is required, not just a new
 *   device: transformers.js 3.8.1 chains every web inference on one promise
 *   with no rejection handler, so after one failed run every later run in
 *   that module scope rejects too.
 * - Native CPU process exited: reload, which starts a fresh process.
 */
function recoverKokoro(backend: string, message: string): boolean {
	const gpuFault = backend === "webgpu" && message !== ENGINE_RESET;
	const nodeDied = backend === "node" && NODE_DEAD_RE.test(message);
	if (!gpuFault && !nodeDied) return false;
	if (gpuFault) {
		if (!gpuFailed) {
			logWarn("GPU synthesis failed; switching to CPU until settings change.", {
				source: "tts",
				detail: message,
			});
		}
		gpuFailed = true;
	} else {
		logWarn("Native CPU synthesis stopped; restarting it.", {
			source: "tts",
			detail: message,
		});
	}
	// Several in-flight requests fail together; only the first tears down
	// (failing the rest with this same message, so they retry too), the rest
	// wait on the same reload. Teardown also drops cached audio, so nothing
	// made on the failed backend is replayed.
	if (activeDevice === backend) {
		teardownWorker(message);
	}
	return true;
}

function runningOn() {
	return activeDevice === "node" ? nodeDevice : activeDevice;
}

async function synthesizeKokoro(
	text: string,
	voice: string,
	speed: number,
	opts: TtsSynthOptions,
): Promise<Float32Array | null> {
	const result = await requestGenerate(text, voice, speed, opts.epoch);
	if (result.kind === "error") throw new Error(result.message);
	if (result.kind === "empty") return null;
	// Playback and export trust kokoroEngine.sampleRate; a mismatch would play
	// off-pitch without any error.
	if (result.samplingRate !== kokoroEngine.sampleRate) {
		throw new Error(
			`Kokoro returned ${result.samplingRate} Hz audio, expected ${kokoroEngine.sampleRate} Hz`,
		);
	}
	return result.audio;
}

export const kokoroEngine: TtsEngine = {
	id: "kokoro",
	displayName: "Kokoro 82M",
	licence: {
		name: "Apache-2.0",
		url: "https://huggingface.co/hexgrad/Kokoro-82M",
	},
	languages: [...new Set(kokoroVoiceOptions().map((v) => v.language))],
	/** KOKORO_SAMPLE_RATE (not imported: kokoroModel pulls in transformers.js). */
	sampleRate: 24_000,
	defaultVoice: "af_heart",
	listVoices: kokoroVoiceOptions,
	ensureLoaded: ensureKokoroLoaded,
	activeBackend: () => activeDevice,
	runningOn,
	// Unloaded (e.g. reloading after a GPU fault): don't key audio as the
	// previous load's precision.
	cacheTag: () => (activeDevice ? activeDtype : "unloaded"),
	synthesize: synthesizeKokoro,
	recover: recoverKokoro,
	dispose() {
		teardownWorker();
		// Settings changed: give the GPU another chance on the next load.
		gpuFailed = false;
		const { setModelPhase, setModelProgress } = useTtsStore.getState();
		setModelPhase("idle");
		setModelProgress(null);
	},
	onReset: null,
};

/** Load the model and fetch every Kokoro voice for offline use (Settings). */
export async function downloadVoicesAndModel(
	prefs: TtsBackendPrefs,
): Promise<void> {
	const { setVoiceDownload } = useTtsStore.getState();
	setVoiceDownload("running", {
		voiceDownloadProgress: { loaded: 0, total: 1 },
		voiceDownloadError: null,
	});
	try {
		await ensureKokoroLoaded(prefs);
		await prefetchAllVoiceBins({
			onProgress: (loaded, total) => {
				setVoiceDownload("running", {
					voiceDownloadProgress: { loaded, total },
				});
			},
		});
		setVoiceDownload("done", {
			voiceDownloadProgress: null,
		});
		logInfo("Voices and model downloaded.", { source: "models" });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		setVoiceDownload("error", {
			voiceDownloadError: msg,
		});
		logError("Couldn't download voices and model.", {
			source: "models",
			detail: msg,
		});
		throw e;
	}
}
