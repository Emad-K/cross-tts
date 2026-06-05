import { getKokoroHubBaseUrl } from "@/lib/desktopBridge";
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
import { useTtsStore } from "./ttsStore";

type KokoroDevice = "webgpu" | "wasm";
type KokoroDtype = "fp32" | "q8";

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
/** Device of the currently loaded model, or null when nothing is loaded. */
let activeDevice: KokoroDevice | null = null;

/** Device of the loaded model (null if not loaded). Lets the UI avoid an
 * unnecessary GPU reload when only a CPU-only setting changed. */
export function getActiveDevice(): KokoroDevice | null {
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
}

/** Start the worker and load the model with the given device, once. */
function initWorker(device: KokoroDevice, dtype: KokoroDtype): Promise<void> {
	const base = getKokoroHubBaseUrlSync();
	const numThreads = device === "wasm" ? cpuThreadCount() : 1;
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
	});
	return ready;
}

let audioContext: AudioContext | null = null;
let gainNode: GainNode | null = null;
let activeSource: AudioBufferSourceNode | null = null;

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
	const buf = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
	const data = new Float32Array(raw.audio.length);
	data.set(raw.audio);
	buf.copyToChannel(data, 0, 0);
	return buf;
}

/** Ask the worker to synthesize one chunk's audio. */
function requestGenerate(
	chunkText: string,
	voice: KokoroVoiceId,
	speed: number,
): Promise<GenerateResult> {
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

/** Synthesize one chunk; returns null when there is nothing to speak (skip playback). */
async function synthesizeChunkBuffer(
	ctx: AudioContext,
	chunkText: string,
	voice: KokoroVoiceId,
	speed: number,
): Promise<AudioBuffer | null> {
	if (!isSpeakableChunkText(chunkText)) return null;
	const result = await requestGenerate(chunkText, voice, speed);
	if (result.kind === "error") throw new Error(result.message);
	if (result.kind === "empty") return null;
	return rawToBuffer(ctx, {
		audio: result.audio,
		sampling_rate: result.samplingRate,
	});
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
		const src = ctx.createBufferSource();
		activeSource = src;
		src.buffer = buffer;
		src.connect(gain);
		src.onended = () => {
			if (activeSource === src) activeSource = null;
			resolve();
		};
		try {
			src.start();
		} catch (e) {
			activeSource = null;
			reject(e);
		}
	});
}

function stopActiveSource(): void {
	try {
		activeSource?.stop();
	} catch {
		// already stopped
	}
	activeSource = null;
}

/**
 * Ensure the TTS worker is up and the model is loaded. Loads on the GPU when
 * the preference is enabled and an adapter is present; if GPU initialization
 * fails it automatically retries once on the CPU so playback still works.
 */
export async function ensureKokoroLoaded(): Promise<void> {
	if (worker && workerReady) return workerReady;
	if (!workerReady) {
		const { setModelPhase, setModelProgress } = useTtsStore.getState();
		setModelPhase("loading");
		setModelProgress(0);

		workerReady = (async () => {
			await ensureKokoroHubEnv();
			let { device, dtype } = await resolveKokoroLoadOptions();
			logInfo(`Loading voice model (${device === "webgpu" ? "GPU" : "CPU"})…`, {
				source: "models",
			});
			try {
				await initWorker(device, dtype);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (device === "webgpu") {
					// GPU failed — fall back to CPU so the app still speaks.
					logWarn(
						"GPU synthesis failed to initialize; falling back to CPU.",
						{ source: "models", detail: msg },
					);
					worker?.terminate();
					worker = null;
					device = "wasm";
					dtype = "q8";
					await initWorker(device, dtype);
				} else {
					throw e;
				}
			}
			activeDevice = device;
			setModelPhase("ready");
			setModelProgress(1);
			logInfo(
				`Voice model ready (${device === "webgpu" ? "GPU" : "CPU"}) — ` +
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
	let nextPrefetchIdx: number | null = null;
	let nextPrefetchBuffer: AudioBuffer | null = null;
	let prefetchGeneration = 0;

	while (!signal.aborted) {
		const snap = useTtsStore.getState();
		const { chunks } = snap;
		if (idx >= chunks.length) break;

		const chunk = chunks[idx];
		if (!chunk) break;

		const total = chunks.length;

		if (nextPrefetchIdx !== null && nextPrefetchIdx !== idx) {
			prefetchGeneration += 1;
			nextPrefetchIdx = null;
			nextPrefetchBuffer = null;
		}

		const canUsePrefetch =
			nextPrefetchIdx === idx &&
			nextPrefetchBuffer !== null &&
			isSpeakableChunkText(chunk.text);

		useTtsStore.setState({
			playback: canUsePrefetch ? "playing" : "buffering",
			currentChunkIndex: idx,
			highlightRange: { start: chunk.start, end: chunk.end },
			progressPct: chunkProgressPct(idx, total),
			elapsedSec: idx,
			totalSec: total,
		});

		let buffer: AudioBuffer | null = null;
		if (canUsePrefetch && nextPrefetchBuffer) {
			buffer = nextPrefetchBuffer;
			nextPrefetchIdx = null;
			nextPrefetchBuffer = null;
		} else {
			nextPrefetchIdx = null;
			nextPrefetchBuffer = null;
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
		}

		if (signal.aborted) break;

		if (!buffer) {
			idx += 1;
			useTtsStore.setState({ currentChunkIndex: idx });
			continue;
		}

		// Prefetch the next chunk while current one plays.
		if (idx + 1 < chunks.length) {
			const nextIndex: number = idx + 1;
			const nextCh = chunks[nextIndex]!;
			const voice = snap.voice;
			const speed = snap.speed;
			const rulesSig = useTtsRulesStore.getState().signature;
			const nextTextSnapshot = nextCh.text;

			if (isSpeakableChunkText(nextTextSnapshot)) {
				const prefetchGen = ++prefetchGeneration;
				void synthesizeChunkBuffer(ctx, nextTextSnapshot, voice, speed)
					.then((buf) => {
						if (signal.aborted) return;
						if (prefetchGen !== prefetchGeneration) return;
						if (!isSpeakableChunkText(nextTextSnapshot)) return;
						const st = useTtsStore.getState();
						const ch = st.chunks[nextIndex];
						if (
							!ch ||
							ch.text !== nextTextSnapshot ||
							st.voice !== voice ||
							st.speed !== speed ||
							useTtsRulesStore.getState().signature !== rulesSig
						) {
							return;
						}
						if (!buf) return;
						nextPrefetchIdx = nextIndex;
						nextPrefetchBuffer = buf;
					})
					.catch(() => {});
			}
		}

		if (useTtsStore.getState().playback !== "paused") {
			useTtsStore.setState({ playback: "playing" });
		}

		await playBuffer(ctx, gain, buffer, signal);

		if (signal.aborted) break;

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
			elapsedSec: 0,
			totalSec: null,
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
		await resumePlayback();
		return;
	}

	interruptPlaybackForReschedule();
	const ab = new AbortController();
	playbackAbort = ab;
	playbackLoopPromise = runPlaybackLoop(ab.signal);
	void playbackLoopPromise;
}

export function restartPlaybackIfPlaying(): void {
	const p = useTtsStore.getState().playback;
	if (p !== "playing" && p !== "buffering") return;
	interruptPlaybackForReschedule();
	const ab = new AbortController();
	playbackAbort = ab;
	playbackLoopPromise = runPlaybackLoop(ab.signal);
	void playbackLoopPromise;
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
	const { playback, seekToChunk } = useTtsStore.getState();
	seekToChunk(index);
	if (playback === "playing" || playback === "buffering") {
		interruptPlaybackForReschedule();
		const ab = new AbortController();
		playbackAbort = ab;
		playbackLoopPromise = runPlaybackLoop(ab.signal);
		void playbackLoopPromise;
	}
}

export function seekProgressPercent(pct: number): void {
	const { chunks, seekToChunk } = useTtsStore.getState();
	if (chunks.length === 0) return;
	const clamped = Math.max(0, Math.min(100, pct));
	const n = chunks.length;
	const idx =
		n <= 1 ? 0 : Math.round((clamped / 100) * (n - 1));
	const clampedIdx = Math.max(0, Math.min(n - 1, idx));
	seekToChunk(clampedIdx);
	const pb = useTtsStore.getState().playback;
	if (pb === "playing" || pb === "buffering") {
		interruptPlaybackForReschedule();
		const ab = new AbortController();
		playbackAbort = ab;
		playbackLoopPromise = runPlaybackLoop(ab.signal);
		void playbackLoopPromise;
	}
}

export function skipChunk(delta: number): void {
	const { chunks, currentChunkIndex, seekToChunk } = useTtsStore.getState();
	if (chunks.length === 0) return;
	const next = Math.max(
		0,
		Math.min(chunks.length - 1, currentChunkIndex + delta),
	);
	seekToChunk(next);
	const pb = useTtsStore.getState().playback;
	if (pb === "playing" || pb === "buffering") {
		interruptPlaybackForReschedule();
		const ab = new AbortController();
		playbackAbort = ab;
		playbackLoopPromise = runPlaybackLoop(ab.signal);
		void playbackLoopPromise;
	}
}

export function stopPlaybackUi(): void {
	interruptPlaybackForReschedule();
	void getAudioGraph().ctx.suspend();
	useTtsStore.setState({
		playback: "idle",
		highlightRange: null,
	});
}
