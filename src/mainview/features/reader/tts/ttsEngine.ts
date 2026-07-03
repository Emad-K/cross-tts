import { resampleSinc } from "@shared/resampleSinc";
import {
	getKokoroHubBaseUrl,
	onTtsNodeProgress,
	ttsNodeGenerate,
	ttsNodeInit,
	ttsNodeStop,
} from "@/lib/desktopBridge";
import { logError, logInfo, logWarn } from "../logging";
import {
	effectiveCpuThreads,
	isGpuPreferenceEnabled,
	useAppSettingsStore,
} from "../settings/appSettingsStore";
import { getKokoroHubBaseUrlSync, setKokoroHubBaseUrl } from "./kokoroHubConfig";
import type { KokoroVoiceId } from "./kokoroVoices";
import { prefetchAllVoiceBins } from "./prefetchKokoroAssets";
import {
	getTtsRulesForEngine,
	useTtsRulesStore,
} from "../ttsRules/ttsRulesStore";
import { isSpeakableChunkText, textForTtsSynthesis } from "./ttsChunkText";
import { useListenEstimateStore } from "../listenEstimate/listenEstimateStore";
import { AudioCache, audioCacheKey } from "./ttsAudioCache";
import { useSweepStore } from "./sweepStore";
import { useTtsStore } from "./ttsStore";

/** How many upcoming chunks to synthesize ahead so playback never waits. */
const PREFETCH_AHEAD = 2;

/** Synthesized chunk audio, keyed by voice/speed/rules/text (see audioCacheKey). */
const audioBufferCache = new AudioCache<AudioBuffer>(64);

function rulesSignature(): string {
	return useTtsRulesStore.getState().signature;
}

type KokoroDevice = "webgpu" | "wasm";
type KokoroDtype = "fp32" | "q8";
/**
 * Where synthesis actually runs: the renderer worker (webgpu/wasm) or the
 * native onnxruntime-node utility process ("node" — the preferred CPU path,
 * ~2.5× faster than wasm; see src/bun/ttsNodeWorker.ts).
 */
type KokoroBackend = KokoroDevice | "node";

/** Raw audio handed back from the worker, ready to wrap in an AudioBuffer. */
type RawTtsAudio = { audio: Float32Array; sampling_rate: number };

/** Result of a single chunk synthesis request to the worker. */
type GenerateResult =
	| { kind: "audio"; audio: Float32Array; samplingRate: number }
	| { kind: "empty" }
	| { kind: "error"; message: string };

let hubEnvPromise: Promise<void> | null = null;

async function configureKokoroHubEnv(): Promise<void> {
	const base = await getKokoroHubBaseUrl();
	setKokoroHubBaseUrl(base);
}

function ensureKokoroHubEnv(): Promise<void> {
	if (!hubEnvPromise) hubEnvPromise = configureKokoroHubEnv();
	return hubEnvPromise;
}

/**
 * Number of ORT wasm threads to request for CPU synthesis, plus a one-time log
 * of the runtime state (threading needs SharedArrayBuffer, enabled by the main
 * process via the Chromium "SharedArrayBuffer" feature).
 */
function cpuThreadCount(): number {
	const threads = effectiveCpuThreads();
	const hasSab = typeof SharedArrayBuffer !== "undefined";
	logInfo(
		`CPU synthesis: ${threads} thread(s) requested, worker on ` +
			`(SharedArrayBuffer=${hasSab}).`,
		{ source: "models" },
	);
	if (!hasSab) {
		logWarn(
			"No SharedArrayBuffer — CPU synthesis runs single-threaded (slower). Enable GPU in Settings if you have a compatible GPU.",
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

/** Backend of the loaded model (null if not loaded). Lets the UI avoid an
 * unnecessary GPU reload when only a CPU-only setting changed. */
export function getActiveDevice(): KokoroBackend | null {
	return activeDevice;
}

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
				useTtsStore.getState().setVoiceOptions(msg.voices);
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
		onWorkerInitError?.(new Error(e.message || "TTS worker crashed"));
	};
	return w;
}

function teardownWorker(): void {
	if (activeDevice === "node") void ttsNodeStop();
	worker?.terminate();
	worker = null;
	workerReady = null;
	activeDevice = null;
	onWorkerReady = null;
	onWorkerInitError = null;
	for (const resolve of pending.values()) {
		resolve({ kind: "error", message: "TTS engine reset" });
	}
	pending.clear();
	// Audio differs by device (q8 CPU vs fp32 GPU) and reload, so don't keep
	// buffers across a teardown.
	audioBufferCache.clear();
}

/** Start the worker and load the model with the given device, once. */
function initWorker(device: KokoroDevice, dtype: KokoroDtype): Promise<void> {
	const base = getKokoroHubBaseUrlSync();
	const numThreads = device === "wasm" ? cpuThreadCount() : 1;
	const gpuPower =
		useAppSettingsStore.getState().config?.gpuPower ?? "auto";
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
		gpuPower,
	});
	return ready;
}

let audioContext: AudioContext | null = null;
let gainNode: GainNode | null = null;
let activeSources: AudioBufferSourceNode[] = [];

let playbackAbort: AbortController | null = null;
let playbackLoopPromise: Promise<void> | null = null;

/** Return true when the handler advanced to the next chapter and will resume playback. */
type ChapterPlaybackFinishedHandler = () => boolean | Promise<boolean>;
let chapterPlaybackFinishedHandler: ChapterPlaybackFinishedHandler | null =
	null;

export function setChapterPlaybackFinishedHandler(
	handler: ChapterPlaybackFinishedHandler | null,
): void {
	chapterPlaybackFinishedHandler = handler;
}

/** Probe whether a usable WebGPU adapter exists, and record it for the UI. */
async function detectWebgpu(): Promise<boolean> {
	let available = false;
	try {
		if (typeof navigator !== "undefined" && navigator.gpu) {
			const adapter = await navigator.gpu.requestAdapter();
			available = !!adapter;
		}
	} catch {
		available = false;
	}
	useAppSettingsStore.getState().setWebgpuAvailable(available);
	return available;
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
 * we fall back to CPU.
 */
async function resolveKokoroLoadOptions(): Promise<{
	device: KokoroDevice;
	dtype: KokoroDtype;
}> {
	const wantGpu = isGpuPreferenceEnabled();
	const hasGpu = wantGpu ? await detectWebgpu() : false;
	const device: KokoroDevice = wantGpu && hasGpu ? "webgpu" : "wasm";
	const dtype: KokoroDtype = device === "webgpu" ? "fp32" : "q8";
	return { device, dtype };
}

function chunkProgressPct(idx: number, total: number): number {
	if (total <= 0) return 0;
	if (total <= 1) return 100;
	return Math.min(100, (idx / (total - 1)) * 100);
}

function getAudioGraph(): { ctx: AudioContext; gain: GainNode } {
	if (!audioContext) {
		audioContext = new AudioContext();
		gainNode = audioContext.createGain();
		gainNode.connect(audioContext.destination);
	}
	return { ctx: audioContext, gain: gainNode! };
}

function applyVolumeFromStore(): void {
	const g = gainNode;
	if (!g) return;
	g.gain.value = useTtsStore.getState().volumePct / 100;
}

function rawToBuffer(ctx: AudioContext, raw: RawTtsAudio): AudioBuffer {
	// Resample to the context's own rate ourselves so Chromium never resamples
	// the AudioBufferSource. On Linux its per-buffer resampler is broken — a
	// 24 kHz buffer in a 48 kHz context plays at 2× (chipmunk), and matching the
	// context to 24 kHz instead pushes a whistly artifact into the device output
	// resampler. Creating the buffer already at ctx.sampleRate avoids both.
	// Windowed sinc, not linear: linear interpolation leaves audible spectral
	// images above 12 kHz (a faint metallic sheen on every Linux sentence).
	const resampled =
		raw.sampling_rate === ctx.sampleRate
			? raw.audio
			: resampleSinc(raw.audio, raw.sampling_rate, ctx.sampleRate);
	// Copy into a fresh ArrayBuffer-backed array: copyToChannel rejects the
	// SharedArrayBuffer-backed view the worker hands back under cross-origin isolation.
	const data = new Float32Array(resampled.length);
	data.set(resampled);
	const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
	buf.copyToChannel(data, 0, 0);
	return buf;
}

/** Synthesize one chunk on the native (onnxruntime-node) CPU backend. */
async function requestGenerateNode(
	chunkText: string,
	voice: KokoroVoiceId,
	speed: number,
): Promise<GenerateResult> {
	const text = textForTtsSynthesis(chunkText);
	const { pronunciationRules } = getTtsRulesForEngine();
	const result = await ttsNodeGenerate({
		text,
		voice,
		speed,
		pronunciationRules,
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
		return {
			kind: "audio",
			audio: result.audio,
			samplingRate: result.samplingRate,
		};
	}
	return result;
}

/** Ask the active backend to synthesize one chunk's audio. */
function requestGenerate(
	chunkText: string,
	voice: KokoroVoiceId,
	speed: number,
): Promise<GenerateResult> {
	if (activeDevice === "node") {
		return requestGenerateNode(chunkText, voice, speed);
	}
	const w = worker;
	if (!w) return Promise.resolve({ kind: "error", message: "Engine not ready" });
	const text = textForTtsSynthesis(chunkText);
	const { pronunciationRules } = getTtsRulesForEngine();
	const id = ++reqSeq;
	return new Promise<GenerateResult>((resolve) => {
		pending.set(id, resolve);
		w.postMessage({
			type: "generate",
			id,
			text,
			voice,
			speed,
			pronunciationRules,
		});
	});
}

/**
 * Synthesize one chunk; returns null when there is nothing to speak. Cached and
 * de-duplicated by {@link audioBufferCache}, so seeks, re-reads, and the loop
 * catching up to its own prefetch never re-run the model.
 */
async function synthesizeChunkBuffer(
	ctx: AudioContext,
	chunkText: string,
	voice: KokoroVoiceId,
	speed: number,
): Promise<AudioBuffer | null> {
	if (!isSpeakableChunkText(chunkText)) return null;
	const key = audioCacheKey(chunkText, voice, speed, rulesSignature());
	return audioBufferCache.getOrCreate(key, async () => {
		const result = await requestGenerate(chunkText, voice, speed);
		if (result.kind === "error") throw new Error(result.message);
		if (result.kind === "empty") return null;
		return rawToBuffer(ctx, {
			audio: result.audio,
			sampling_rate: result.samplingRate,
		});
	});
}

/** True when this chunk's audio is already synthesized (instant playback). */
function hasCachedChunkAudio(
	chunkText: string,
	voice: KokoroVoiceId,
	speed: number,
): boolean {
	if (!isSpeakableChunkText(chunkText)) return false;
	return audioBufferCache.has(
		audioCacheKey(chunkText, voice, speed, rulesSignature()),
	);
}

/** Fire-and-forget synthesis of the next `count` chunks into the cache. */
function prefetchChunks(
	ctx: AudioContext,
	chunks: { text: string }[],
	from: number,
	count: number,
	voice: KokoroVoiceId,
	speed: number,
	signal: AbortSignal,
): void {
	for (let j = from; j < from + count && j < chunks.length; j++) {
		if (signal.aborted) return;
		const text = chunks[j]?.text;
		if (!text || !isSpeakableChunkText(text)) continue;
		void synthesizeChunkBuffer(ctx, text, voice, speed).catch(() => {});
	}
}

/** Synthesize one chunk to raw PCM (for audiobook export). Null = nothing to speak. */
export async function synthesizeChunkPcm(
	chunkText: string,
	voice: KokoroVoiceId,
	speed: number,
): Promise<{ audio: Float32Array; sampleRate: number } | null> {
	if (!isSpeakableChunkText(chunkText)) return null;
	const result = await requestGenerate(chunkText, voice, speed);
	if (result.kind === "error") throw new Error(result.message);
	if (result.kind === "empty") return null;
	return { audio: result.audio, sampleRate: result.samplingRate };
}

/**
 * Chromium on Linux plays an AudioBufferSourceNode whose buffer exceeds ~2^19
 * samples at 2× (chipmunk). Keep each scheduled source comfortably under that.
 */
const SAFE_SOURCE_SAMPLES = 1 << 18;
/**
 * Adjacent segments overlap by this many samples and linear-crossfade. The
 * overlap region is the SAME source samples in both buffers, so gains summing
 * to 1 reconstruct the original waveform exactly — no boundary click/whistle.
 */
const SEGMENT_XFADE_SAMPLES = 256;
/**
 * Split playback schedules against a clock captured slightly in the future.
 * A start time captured before the sliceBuffer copies is already in the past
 * when the audio thread dequeues segment 0's start(); the spec clamps it to
 * "now", sliding segment 0 a few ms off the absolute timeline its own gain
 * envelope and every other segment still follow. The misaligned overlap then
 * blends two time-shifted copies — a comb/whistle at the first seam.
 */
const SCHEDULE_HEADROOM_S = 0.05;

/** Copy a [start, start+len) slice of `buffer`'s channel 0 into a new AudioBuffer. */
function sliceBuffer(
	ctx: AudioContext,
	buffer: AudioBuffer,
	start: number,
	len: number,
): AudioBuffer {
	const seg = ctx.createBuffer(1, len, buffer.sampleRate);
	const tmp = new Float32Array(len);
	buffer.copyFromChannel(tmp, 0, start);
	seg.copyToChannel(tmp, 0, 0);
	return seg;
}

function playBuffer(
	ctx: AudioContext,
	gain: GainNode,
	buffer: AudioBuffer,
	signal: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			resolve();
			return;
		}

		// Drive the in-sentence progress sweep from the audio clock. ctx.currentTime
		// freezes while suspended (pause), so the sweep pauses for free. No real
		// per-token timing exists, so this is a duration-proportional estimate.
		// Assigned below, after the segment slices are built (see
		// SCHEDULE_HEADROOM_S); the sweep only starts once scheduling is done.
		let startTime = 0;
		const duration = buffer.duration || 0;
		let raf = 0;
		const tick = () => {
			if (signal.aborted) return;
			const p =
				duration > 0
					? Math.min(1, Math.max(0, (ctx.currentTime - startTime) / duration))
					: 0;
			useSweepStore.getState().setProgress(p);
			raf = requestAnimationFrame(tick);
		};

		// Split overlong buffers into sub-buffer sources, each under the Chromium
		// limit, overlapping + crossfading at the seams. Resolve when the final
		// segment ends; stopActiveSource() stops every scheduled source.
		try {
			const total = buffer.length;
			const rate = buffer.sampleRate;
			const xf = SEGMENT_XFADE_SAMPLES;
			// Segment i covers source [bound_i - xf, bound_{i+1}); the leading xf
			// samples (i>0) overlap the previous segment's trailing xf.
			const segments: { start: number; end: number }[] = [];
			for (let b = 0; b < total; b += SAFE_SOURCE_SAMPLES) {
				segments.push({
					start: b === 0 ? 0 : b - xf,
					end: Math.min(b + SAFE_SOURCE_SAMPLES, total),
				});
			}
			const single = segments.length === 1;
			activeSources = [];
			// Build every slice BEFORE capturing the clock so segment 0's start
			// time is never already in the past (clamped ≠ aligned — see
			// SCHEDULE_HEADROOM_S). Single-segment playback needs no alignment,
			// so it keeps the zero-latency start.
			const nodes = segments.map((seg) => {
				const src = ctx.createBufferSource();
				src.buffer = single
					? buffer
					: sliceBuffer(ctx, buffer, seg.start, seg.end - seg.start);
				return { seg, src };
			});
			startTime = ctx.currentTime + (single ? 0 : SCHEDULE_HEADROOM_S);
			nodes.forEach(({ seg, src }, i) => {
				const segStart = startTime + seg.start / rate;
				if (single) {
					src.connect(gain);
				} else {
					const g = ctx.createGain();
					src.connect(g);
					g.connect(gain);
					if (i > 0) {
						// Fade in across the leading overlap.
						g.gain.setValueAtTime(0, segStart);
						g.gain.linearRampToValueAtTime(1, segStart + xf / rate);
					}
					if (i < segments.length - 1) {
						// Fade out across the trailing overlap.
						const fadeOut = startTime + (seg.end - xf) / rate;
						g.gain.setValueAtTime(1, fadeOut);
						g.gain.linearRampToValueAtTime(0, fadeOut + xf / rate);
					}
				}
				if (i === segments.length - 1) {
					src.onended = () => {
						activeSources = [];
						cancelAnimationFrame(raf);
						resolve();
					};
				}
				src.start(segStart);
				activeSources.push(src);
			});
			raf = requestAnimationFrame(tick);
		} catch (e) {
			activeSources = [];
			cancelAnimationFrame(raf);
			reject(e);
		}
	});
}

function stopActiveSource(): void {
	for (const src of activeSources) {
		try {
			src.stop();
		} catch {
			// already stopped
		}
	}
	activeSources = [];
}

/**
 * Load the model on the preferred CPU backend: the native onnxruntime-node
 * utility process (~2.5× faster than the wasm worker — fp32 native measures
 * 3.5–4× realtime where wasm q8 hovers near 1×). Returns null when the bridge
 * is unavailable (web build) or the process failed, so the caller can fall
 * back to the wasm worker.
 */
async function initNodeBackend(): Promise<"node" | null> {
	const { setModelProgress } = useTtsStore.getState();
	const unsubscribe = onTtsNodeProgress((value) => setModelProgress(value));
	try {
		logInfo("Loading voice model (CPU, native)…", { source: "models" });
		loggedFirstSynth = false;
		const result = await ttsNodeInit();
		if (!result) return null;
		if (!result.ok) {
			logWarn(
				"Native CPU synthesis failed to start; falling back to in-app CPU.",
				{ source: "models", detail: result.error },
			);
			return null;
		}
		// The utility process reports voice ids as plain strings (it can't see the
		// renderer's KokoroVoiceId union); they come from the same model metadata.
		useTtsStore
			.getState()
			.setVoiceOptions(result.voices as { id: KokoroVoiceId; label: string }[]);
		lastLoadMs = result.loadMs;
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
 * Ensure a TTS backend is up and the model is loaded. Preference order:
 * WebGPU (when enabled and present) → native CPU utility process → wasm
 * worker. Each step falls through to the next on failure so playback works.
 */
export async function ensureKokoroLoaded(): Promise<void> {
	if (worker && workerReady) return workerReady;
	if (!workerReady) {
		const { setModelPhase, setModelProgress } = useTtsStore.getState();
		setModelPhase("loading");
		setModelProgress(0);

		workerReady = (async () => {
			await ensureKokoroHubEnv();
			const { device, dtype } = await resolveKokoroLoadOptions();
			let backend: KokoroBackend | null = null;
			if (device === "webgpu") {
				logInfo("Loading voice model (GPU)…", { source: "models" });
				try {
					await initWorker(device, dtype);
					backend = "webgpu";
				} catch (e) {
					// GPU failed — fall through to the CPU paths so the app still speaks.
					logWarn("GPU synthesis failed to initialize; falling back to CPU.", {
						source: "models",
						detail: e instanceof Error ? e.message : String(e),
					});
					worker?.terminate();
					worker = null;
				}
			}
			if (!backend) backend = await initNodeBackend();
			if (!backend) {
				logInfo("Loading voice model (CPU)…", { source: "models" });
				await initWorker("wasm", "q8");
				backend = "wasm";
			}
			activeDevice = backend;
			setModelPhase("ready");
			setModelProgress(1);
			const label =
				backend === "webgpu"
					? "GPU"
					: backend === "node"
						? "CPU, native"
						: "CPU, in-app";
			logInfo(
				`Voice model ready (${label}) — ` +
					`loaded in ${(lastLoadMs / 1000).toFixed(1)}s.`,
				{ source: "models" },
			);
		})().catch((e: unknown) => {
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
 * Drop the loaded model so the next playback reloads with current options
 * (e.g. after the GPU/CPU preference changed — they use different weights).
 * Stops any active playback first.
 */
export function resetKokoroEngine(): void {
	stopPlaybackUi();
	teardownWorker();
	const { setModelPhase, setModelProgress } = useTtsStore.getState();
	setModelPhase("idle");
	setModelProgress(null);
}

export async function downloadVoicesAndModel(): Promise<void> {
	const { setVoiceDownload } = useTtsStore.getState();
	setVoiceDownload("running", {
		voiceDownloadProgress: { loaded: 0, total: 1 },
		voiceDownloadError: null,
	});
	try {
		await ensureKokoroLoaded();
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

function interruptPlaybackForReschedule(): void {
	playbackAbort?.abort();
	stopActiveSource();
	playbackLoopPromise = null;
	playbackAbort = null;
}

/** Stop any current loop and start a fresh one from the store's current chunk. */
function startPlaybackLoopFresh(): void {
	interruptPlaybackForReschedule();
	const ab = new AbortController();
	playbackAbort = ab;
	playbackLoopPromise = runPlaybackLoop(ab.signal);
	void playbackLoopPromise;
}

/** Re-seek the loop to the store's current chunk, preserving play/pause state. */
function rescheduleForSeek(): void {
	const pb = useTtsStore.getState().playback;
	if (pb === "playing" || pb === "buffering") {
		startPlaybackLoopFresh();
	} else if (pb === "paused") {
		// Drop the suspended loop holding the old position so the next resume
		// starts a fresh loop at the seeked chunk (not where it was paused).
		interruptPlaybackForReschedule();
	}
}

export async function pausePlayback(): Promise<void> {
	const { ctx } = getAudioGraph();
	await ctx.suspend();
	useTtsStore.setState({ playback: "paused" });
}

export async function resumePlayback(): Promise<void> {
	const { ctx } = getAudioGraph();
	applyVolumeFromStore();
	await ctx.resume();
	useTtsStore.setState({ playback: "playing" });
}

export function setVolumeLive(pct: number): void {
	useTtsStore.getState().setVolumePct(pct);
	applyVolumeFromStore();
}

/** Nudge volume by `delta` percentage points, clamped to 0–100. */
export function adjustVolume(delta: number): void {
	const current = useTtsStore.getState().volumePct;
	setVolumeLive(Math.max(0, Math.min(100, current + delta)));
}

let preMuteVolume: number | null = null;

/** Toggle mute: drop to 0 (remembering the level), or restore it. */
export function toggleMute(): void {
	const current = useTtsStore.getState().volumePct;
	if (current > 0) {
		preMuteVolume = current;
		setVolumeLive(0);
	} else {
		setVolumeLive(preMuteVolume && preMuteVolume > 0 ? preMuteVolume : 80);
		preMuteVolume = null;
	}
}

/**
 * Wait out the configured inter-sentence pause. Counts down only while
 * actually playing (a user pause freezes the gap too) and returns at once
 * when the loop is aborted (seek, chapter change, stop).
 */
async function waitSentencePause(signal: AbortSignal): Promise<void> {
	const total = useTtsStore.getState().sentencePauseMs;
	if (total <= 0) return;
	const TICK_MS = 50;
	let remaining = total;
	while (remaining > 0 && !signal.aborted) {
		await new Promise((resolve) => setTimeout(resolve, TICK_MS));
		if (signal.aborted) return;
		if (useTtsStore.getState().playback === "playing") remaining -= TICK_MS;
	}
}

async function runPlaybackLoop(signal: AbortSignal): Promise<void> {
	if (useTtsStore.getState().chunks.length === 0) return;

	useTtsStore.setState({ playback: "loading_model", playbackError: null });
	try {
		await ensureKokoroLoaded();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		useTtsStore.setState({
			playback: "idle",
			playbackError: msg,
		});
		return;
	}

	const { ctx, gain } = getAudioGraph();
	applyVolumeFromStore();
	await ctx.resume();

	if (signal.aborted) return;

	let idx = useTtsStore.getState().currentChunkIndex;

	while (!signal.aborted) {
		const snap = useTtsStore.getState();
		const { chunks } = snap;
		if (idx >= chunks.length) break;

		const chunk = chunks[idx];
		if (!chunk) break;

		const total = chunks.length;

		// Already-synthesized chunks (prefetched, or revisited via seek) play
		// instantly; the audio cache keys on voice/speed/rules/text, so stale
		// settings simply miss and re-synthesize.
		const cached = hasCachedChunkAudio(chunk.text, snap.voice, snap.speed);

		useSweepStore.getState().setProgress(0);
		useTtsStore.setState({
			playback: cached ? "playing" : "buffering",
			currentChunkIndex: idx,
			highlightRange: { start: chunk.start, end: chunk.end },
			progressPct: chunkProgressPct(idx, total),
		});

		let buffer: AudioBuffer | null = null;
		try {
			buffer = await synthesizeChunkBuffer(
				ctx,
				chunk.text,
				snap.voice,
				snap.speed,
			);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			useTtsStore.setState({ playback: "idle", playbackError: msg });
			logError("Playback stopped: couldn't synthesize audio.", {
				source: "tts",
				detail: msg,
			});
			return;
		}

		if (signal.aborted) break;

		if (!buffer) {
			idx += 1;
			useTtsStore.setState({ currentChunkIndex: idx });
			continue;
		}

		// Feed the listen-time estimate with the measured chars→audio rate, and
		// pin this chunk's exact length for the elapsed/total chapter clock.
		useListenEstimateStore
			.getState()
			.recordSample(chunk.text.length, buffer.duration, snap.speed);
		useTtsStore
			.getState()
			.recordChunkBaseSec(idx, buffer.duration * snap.speed);

		// Warm the cache for upcoming chunks so playback never waits on
		// synthesis, even when the current chunk is short.
		prefetchChunks(
			ctx,
			chunks,
			idx + 1,
			PREFETCH_AHEAD,
			snap.voice,
			snap.speed,
			signal,
		);

		if (useTtsStore.getState().playback !== "paused") {
			useTtsStore.setState({ playback: "playing" });
		}

		await playBuffer(ctx, gain, buffer, signal);

		if (signal.aborted) break;

		// Breathing room between sentences (skipped at the chapter's end).
		if (idx + 1 < useTtsStore.getState().chunks.length) {
			await waitSentencePause(signal);
			if (signal.aborted) break;
		}

		idx += 1;
		useTtsStore.setState({ currentChunkIndex: idx });
	}

	const snap = useTtsStore.getState();
	if (!signal.aborted && idx >= snap.chunks.length) {
		if (chapterPlaybackFinishedHandler) {
			try {
				const advanced = await chapterPlaybackFinishedHandler();
				if (advanced) return;
			} catch {
				// Fall through to normal end-of-chapter idle state.
			}
		}
		useTtsStore.setState({
			playback: "idle",
			currentChunkIndex: 0,
			highlightRange: null,
			progressPct: 100,
		});
	} else if (!signal.aborted) {
		useTtsStore.setState({ playback: "idle" });
	}
}

export async function startOrResumePlayback(): Promise<void> {
	const { playback, chunks } = useTtsStore.getState();
	if (chunks.length === 0) return;

	if (
		playback === "playing" ||
		playback === "loading_model" ||
		playback === "buffering"
	) {
		return;
	}

	if (playback === "paused") {
		// A live (suspended) loop just needs the audio clock resumed; if it was
		// dropped (seeked while paused) start a fresh loop at the current chunk.
		if (playbackLoopPromise) {
			await resumePlayback();
			return;
		}
	}

	startPlaybackLoopFresh();
}

export function restartPlaybackIfPlaying(): void {
	const p = useTtsStore.getState().playback;
	if (p !== "playing" && p !== "buffering") return;
	startPlaybackLoopFresh();
}

export async function togglePlayPause(): Promise<void> {
	const { playback } = useTtsStore.getState();
	if (playback === "playing" || playback === "buffering") {
		await pausePlayback();
		return;
	}
	await startOrResumePlayback();
}

export function seekToChunkAndMaybePlay(index: number): void {
	useTtsStore.getState().seekToChunk(index);
	rescheduleForSeek();
}

/**
 * Click-to-play: seek to a chunk and make sure playback is running from there.
 * If already playing, {@link rescheduleForSeek} restarted the loop at the new
 * chunk and {@link startOrResumePlayback} is a no-op; if paused/idle it starts
 * a fresh loop at the seeked chunk.
 */
export function seekToChunkAndPlay(index: number): void {
	seekToChunkAndMaybePlay(index);
	void startOrResumePlayback();
}

export function seekProgressPercent(pct: number): void {
	const { chunks, seekToChunk } = useTtsStore.getState();
	if (chunks.length === 0) return;
	const clamped = Math.max(0, Math.min(100, pct));
	const n = chunks.length;
	const idx = n <= 1 ? 0 : Math.round((clamped / 100) * (n - 1));
	seekToChunk(Math.max(0, Math.min(n - 1, idx)));
	rescheduleForSeek();
}

export function skipChunk(delta: number): void {
	const { chunks, currentChunkIndex, seekToChunk } = useTtsStore.getState();
	if (chunks.length === 0) return;
	const next = Math.max(
		0,
		Math.min(chunks.length - 1, currentChunkIndex + delta),
	);
	seekToChunk(next);
	rescheduleForSeek();
}

export function stopPlaybackUi(): void {
	interruptPlaybackForReschedule();
	void getAudioGraph().ctx.suspend();
	useSweepStore.getState().setProgress(0);
	useTtsStore.setState({
		playback: "idle",
		highlightRange: null,
	});
}
