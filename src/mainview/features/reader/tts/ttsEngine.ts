import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import { getKokoroHubBaseUrl } from "@/lib/desktopBridge";
import { logError, logInfo, logWarn } from "../logging";
import {
	isGpuPreferenceEnabled,
	useAppSettingsStore,
} from "../settings/appSettingsStore";
import { setKokoroHubBaseUrl } from "./kokoroHubConfig";
import { KOKORO_MODEL_ID, type KokoroVoiceId } from "./kokoroVoices";
import { prefetchAllVoiceBins } from "./prefetchKokoroAssets";
import { useTtsRulesStore } from "../ttsRules/ttsRulesStore";
import {
	isSpeakableChunkText,
	phonemesForTtsSynthesis,
} from "./ttsChunkText";
import { useTtsStore } from "./ttsStore";

type TtsAudio = Awaited<ReturnType<KokoroTTS["generate"]>>;

let ttsInstance: KokoroTTS | null = null;
let loadPromise: Promise<KokoroTTS> | null = null;

let hubEnvPromise: Promise<void> | null = null;

async function configureKokoroHubEnv(): Promise<void> {
	const base = await getKokoroHubBaseUrl();
	setKokoroHubBaseUrl(base);
	if (base) {
		env.remoteHost = base;
		env.useBrowserCache = false;
	}
}

function ensureKokoroHubEnv(): Promise<void> {
	if (!hubEnvPromise) hubEnvPromise = configureKokoroHubEnv();
	return hubEnvPromise;
}

/**
 * Configure the ONNX Runtime wasm backend for CPU synthesis. Without
 * `numThreads` ORT runs single-threaded and is very slow (which also makes the
 * synchronous wasm call block the UI for a long time). Threading needs
 * `SharedArrayBuffer`; the main process enables it via the "SharedArrayBuffer"
 * Chromium feature. If it's still missing ORT falls back to one thread, so we
 * surface that in the log.
 */
function configureWasmBackend(): void {
	try {
		const wasm = env.backends?.onnx?.wasm;
		if (!wasm) return;
		const cores =
			typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
		const threads = Math.max(1, Math.min(cores || 4, 8));
		wasm.numThreads = threads;

		const hasSab = typeof SharedArrayBuffer !== "undefined";
		const isolated =
			typeof crossOriginIsolated !== "undefined"
				? crossOriginIsolated
				: "unknown";
		logInfo(
			`CPU synthesis: ${threads} thread(s) requested ` +
				`(SharedArrayBuffer=${hasSab}, crossOriginIsolated=${isolated}).`,
			{ source: "models" },
		);
		if (!hasSab) {
			logWarn(
				"No SharedArrayBuffer — CPU synthesis is stuck on a single thread, which is slow. Enable GPU in Settings if you have a compatible GPU.",
				{ source: "models" },
			);
		}
	} catch (e) {
		logError("Couldn't configure the CPU inference backend.", {
			source: "models",
			error: e,
		});
	}
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

type KokoroFromPretrainedDtype = NonNullable<
	Parameters<typeof KokoroTTS.from_pretrained>[1]
>["dtype"];

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
 * (wasm) path uses the smaller quantized `q8` weights. The GPU is never used
 * unless the user opted in via Settings; only then do we probe for an adapter,
 * and we fall back to CPU when none is present.
 */
async function resolveKokoroLoadOptions(): Promise<{
	device: "webgpu" | "wasm";
	dtype: KokoroFromPretrainedDtype;
}> {
	const wantGpu = isGpuPreferenceEnabled();
	// Only probe WebGPU when the user enabled GPU — otherwise stay on CPU and
	// don't touch navigator.gpu at all.
	const hasGpu = wantGpu ? await detectWebgpu() : false;
	const device: "webgpu" | "wasm" = wantGpu && hasGpu ? "webgpu" : "wasm";
	const dtype: KokoroFromPretrainedDtype =
		device === "webgpu" ? "fp32" : "q8";
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

function rawToBuffer(ctx: AudioContext, raw: TtsAudio): AudioBuffer {
	const buf = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
	const data = new Float32Array(raw.audio.length);
	data.set(raw.audio);
	buf.copyToChannel(data, 0, 0);
	return buf;
}

/** Synthesize one chunk; returns null when there is nothing to speak (skip playback). */
async function synthesizeChunkBuffer(
	ctx: AudioContext,
	tts: KokoroTTS,
	chunkText: string,
	voice: KokoroVoiceId,
	speed: number,
): Promise<AudioBuffer | null> {
	if (!isSpeakableChunkText(chunkText)) return null;

	const phonemes = await phonemesForTtsSynthesis(chunkText, voice);
	if (phonemes.trim() === "") return null;

	const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
	const raw = await tts.generate_from_ids(input_ids, { voice, speed });
	return rawToBuffer(ctx, raw);
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

function voiceOptionsFromTts(tts: KokoroTTS): {
	id: KokoroVoiceId;
	label: string;
}[] {
	const voices = tts.voices as Record<
		string,
		{ name: string; language?: string }
	>;
	return (Object.keys(voices) as KokoroVoiceId[]).map((id) => {
		const meta = voices[id];
		const lang = meta.language ? ` · ${meta.language}` : "";
		return { id, label: `${meta.name} (${id})${lang}` };
	});
}

export async function ensureKokoroLoaded(): Promise<KokoroTTS> {
	if (ttsInstance) return ttsInstance;
	if (!loadPromise) {
		const { setModelPhase, setModelProgress, setVoiceOptions } =
			useTtsStore.getState();
		setModelPhase("loading");
		setModelProgress(0);
		let resolvedDevice: "webgpu" | "wasm" = "wasm";
		loadPromise = ensureKokoroHubEnv()
			.then(() => resolveKokoroLoadOptions())
			.then(({ device, dtype }) => {
				resolvedDevice = device;
				if (device === "wasm") configureWasmBackend();
				logInfo(
					`Loading voice model (${device === "webgpu" ? "GPU" : "CPU"})…`,
					{ source: "models" },
				);
				return KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
					dtype,
					device,
					progress_callback: (info) => {
						if (info.status === "progress") {
							setModelProgress(info.progress / 100);
						}
					},
				});
			})
			.then((tts) => {
				ttsInstance = tts;
				setVoiceOptions(voiceOptionsFromTts(tts));
				setModelPhase("ready");
				setModelProgress(1);
				logInfo(
					`Voice model ready (${resolvedDevice === "webgpu" ? "GPU" : "CPU"}).`,
					{ source: "models" },
				);
				return tts;
			})
			.catch((e: unknown) => {
				loadPromise = null;
				const msg = e instanceof Error ? e.message : String(e);
				setModelPhase("error", msg);
				logError("Couldn't load the voice model.", {
					source: "models",
					detail: msg,
				});
				throw e;
			});
	}
	return loadPromise;
}

/**
 * Drop the loaded model so the next playback reloads with current options
 * (e.g. after the GPU/CPU preference changed — they use different weights).
 * Stops any active playback first.
 */
export function resetKokoroEngine(): void {
	stopPlaybackUi();
	ttsInstance = null;
	loadPromise = null;
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

async function runPlaybackLoop(signal: AbortSignal): Promise<void> {
	if (useTtsStore.getState().chunks.length === 0) return;

	useTtsStore.setState({ playback: "loading_model", playbackError: null });
	let tts: KokoroTTS;
	try {
		tts = await ensureKokoroLoaded();
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
					tts,
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
				void synthesizeChunkBuffer(ctx, tts, nextTextSnapshot, voice, speed)
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
