import { resampleSinc } from "@shared/resampleSinc";
import { logError } from "../logging";
import {
	effectiveCpuThreads,
	isGpuPreferenceEnabled,
	useAppSettingsStore,
} from "../settings/appSettingsStore";
import { useTtsRulesStore } from "../ttsRules/ttsRulesStore";
import { isSpeakableChunkText, textForTtsSynthesis } from "./ttsChunkText";
import { useListenEstimateStore } from "../listenEstimate/listenEstimateStore";
import { downloadVoicesAndModel as downloadKokoroAssets } from "./kokoroEngine";
import { SynthCore } from "./synthCore";
import type { TtsBackendPrefs, TtsEngine } from "./ttsEngineTypes";
import { getTtsEngine, TTS_ENGINES } from "./ttsEngines";
import { useSweepStore } from "./sweepStore";
import { useTtsStore } from "./ttsStore";

/**
 * Read-ahead, by text rather than chunk count: chunks range from ~48 to 600
 * chars, so a fixed count was seconds of buffer with short chunks and a lot
 * with long ones. Stale read-ahead is cancelled on seek (core.epoch), so a
 * deeper queue doesn't delay the chunk the listener jumps to.
 */
const PREFETCH_CHARS = 700;
const PREFETCH_MAX_CHUNKS = 6;

/** The engine selected in the TTS store (Settings → Voice engine). */
function activeEngine(): TtsEngine {
	return getTtsEngine(useTtsStore.getState().engineId);
}

function backendPrefs(): TtsBackendPrefs {
	return {
		gpu: isGpuPreferenceEnabled(),
		gpuPower: useAppSettingsStore.getState().config?.gpuPower ?? "auto",
		cpuThreads: effectiveCpuThreads(),
	};
}

/** Synthesized chunk audio, keyed by engine/voice/speed/rules/text, plus epochs. */
const core = new SynthCore<AudioBuffer>({
	engine: activeEngine,
	prefs: backendPrefs,
	rulesSignature: () => useTtsRulesStore.getState().signature,
	prepareText: textForTtsSynthesis,
});
core.clearOnReset(TTS_ENGINES);

/** Backend of the loaded model (null if not loaded). Lets the UI avoid an
 * unnecessary GPU reload when only a CPU-only setting changed. */
export function getActiveDevice(): string | null {
	return activeEngine().activeBackend();
}

/** Load the selected engine's model with the current hardware preferences. */
export function ensureTtsLoaded(): Promise<void> {
	return activeEngine().ensureLoaded(backendPrefs());
}

/** Load the model and fetch every voice for offline use (Kokoro only for now). */
export function downloadVoicesAndModel(): Promise<void> {
	return downloadKokoroAssets(backendPrefs());
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

function pcmToBuffer(
	ctx: AudioContext,
	audio: Float32Array,
	sampleRate: number,
): AudioBuffer {
	// Resample to the context's own rate ourselves so Chromium never resamples
	// the AudioBufferSource. On Linux its per-buffer resampler is broken — a
	// 24 kHz buffer in a 48 kHz context plays at 2× (chipmunk), and matching the
	// context to 24 kHz instead pushes a whistly artifact into the device output
	// resampler. Creating the buffer already at ctx.sampleRate avoids both.
	// Windowed sinc, not linear: linear interpolation leaves audible spectral
	// images above 12 kHz (a faint metallic sheen on every Linux sentence).
	const resampled =
		sampleRate === ctx.sampleRate
			? audio
			: resampleSinc(audio, sampleRate, ctx.sampleRate);
	// Copy into a fresh ArrayBuffer-backed array: copyToChannel rejects the
	// SharedArrayBuffer-backed view the worker hands back under cross-origin isolation.
	const data = new Float32Array(resampled.length);
	data.set(resampled);
	const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
	buf.copyToChannel(data, 0, 0);
	return buf;
}

/**
 * Synthesize one chunk; returns null when there is nothing to speak. Cached and
 * de-duplicated by the synth core, so seeks, re-reads, and the loop catching
 * up to its own prefetch never re-run the model.
 */
async function synthesizeChunkBuffer(
	ctx: AudioContext,
	chunkText: string,
	voice: string,
	speed: number,
): Promise<AudioBuffer | null> {
	if (!isSpeakableChunkText(chunkText)) return null;
	return core.get(chunkText, voice, speed, (pcm, rate) =>
		pcmToBuffer(ctx, pcm, rate),
	);
}

/** True when this chunk's audio is already synthesized (instant playback). */
function hasCachedChunkAudio(
	chunkText: string,
	voice: string,
	speed: number,
): boolean {
	if (!isSpeakableChunkText(chunkText)) return false;
	return core.has(chunkText, voice, speed);
}

/**
 * Fire-and-forget synthesis of upcoming chunks into the cache, up to
 * {@link PREFETCH_CHARS} of text (at least one chunk, at most
 * {@link PREFETCH_MAX_CHUNKS}).
 */
function prefetchChunks(
	ctx: AudioContext,
	chunks: { text: string }[],
	from: number,
	voice: string,
	speed: number,
	signal: AbortSignal,
): void {
	let chars = 0;
	for (
		let j = from;
		j < chunks.length && j < from + PREFETCH_MAX_CHUNKS && chars < PREFETCH_CHARS;
		j++
	) {
		if (signal.aborted) return;
		const text = chunks[j]?.text;
		if (!text || !isSpeakableChunkText(text)) continue;
		chars += text.length;
		void synthesizeChunkBuffer(ctx, text, voice, speed).catch(() => {});
	}
}

/**
 * Warm the cache for text that will play soon but isn't loaded yet (the next
 * EPUB chapter's opening chunks), so rolling into it doesn't stall on a cold
 * first chunk. Uses the current voice/speed so the cache keys match
 * playback. Does nothing until a model is loaded.
 */
export function prefetchTexts(texts: string[]): void {
	if (!activeEngine().activeBackend()) return;
	const { voice, speed } = useTtsStore.getState();
	const { ctx } = getAudioGraph();
	for (const text of texts) {
		if (!isSpeakableChunkText(text)) continue;
		void synthesizeChunkBuffer(ctx, text, voice, speed).catch(() => {});
	}
}

/** Synthesize one chunk to raw PCM (for audiobook export). Null = nothing to speak. */
export async function synthesizeChunkPcm(
	chunkText: string,
	voice: string,
	speed: number,
): Promise<{ audio: Float32Array; sampleRate: number } | null> {
	if (!isSpeakableChunkText(chunkText)) return null;
	const { sampleRate } = activeEngine();
	const audio = await core.generate(chunkText, voice, speed);
	return audio ? { audio, sampleRate } : null;
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
 * Drop the loaded model so the next playback reloads with current options
 * (e.g. after the GPU/CPU preference changed — they use different weights).
 * Stops any active playback first.
 */
export function resetTtsEngine(): void {
	stopPlaybackUi();
	activeEngine().dispose();
	core.clear();
}

/**
 * The selected engine changed (`previousId` → store's engineId): unload the
 * old one and drop its audio, then continue playback on the new one.
 */
export function switchTtsEngine(previousId: string): void {
	if (getTtsEngine(previousId) === activeEngine()) return;
	getTtsEngine(previousId).dispose();
	core.clear();
	restartPlaybackIfPlaying();
}

function interruptPlaybackForReschedule(): void {
	core.epoch++;
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
		await ensureTtsLoaded();
	} catch (e) {
		// A reset or stop during the load is not a playback failure.
		if (signal.aborted) return;
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
		// instantly; the audio cache keys on engine/voice/speed/rules/text, so stale
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
			// Stopped, seeked or reset meanwhile: the new owner of playback
			// state decides what to show, not this stale loop.
			if (signal.aborted) return;
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
