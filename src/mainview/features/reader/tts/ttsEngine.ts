import { logError } from "../logging";
import {
	effectiveCpuThreads,
	ttsBackendPreference,
	useAppSettingsStore,
} from "../settings/appSettingsStore";
import { useTtsRulesStore } from "../ttsRules/ttsRulesStore";
import { isSpeakableChunkText, textForTtsSynthesis } from "./ttsChunkText";
import { useListenEstimateStore } from "../listenEstimate/listenEstimateStore";
import { isExportActive } from "../audiobook/exportStore";
import { createIdleWarmer, idleWarmKey } from "./idleWarm";
import { downloadVoicesAndModel as downloadKokoroAssets } from "./kokoroEngine";
import { isBenchmarkRunning } from "./benchmark";
import { splitForFastStart } from "./chunkText";
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
		backend: ttsBackendPreference(),
		gpuPower: useAppSettingsStore.getState().config?.gpuPower ?? "auto",
		cpuThreads: effectiveCpuThreads(),
		gpuFp16: useAppSettingsStore.getState().config?.gpuFp16 ?? false,
	};
}

/**
 * Audio cache budget: ~150 MB of float32 samples. Buffers are cached at the
 * AudioContext rate, already resampled (once, off the UI thread), so a replay
 * or seek-back costs nothing; at 48 kHz that is ~13 minutes of audio, far more
 * than read-ahead (~45 s) needs. Native-rate PCM would hold twice as much but
 * put a ~75 ms resample (13 s chunk) back in front of every cache hit.
 */
const AUDIO_CACHE_SAMPLES = (150 * 1024 * 1024) / Float32Array.BYTES_PER_ELEMENT;

/** Synthesized chunk audio, keyed by engine/voice/speed/rules/text, plus epochs. */
const core = new SynthCore<AudioBuffer>({
	engine: activeEngine,
	prefs: backendPrefs,
	rulesSignature: () => useTtsRulesStore.getState().signature,
	prepareText: textForTtsSynthesis,
	cacheMax: AUDIO_CACHE_SAMPLES,
	cacheCost: (b) => b.length * b.numberOfChannels,
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

/**
 * Perf instrumentation (console.debug, "[tts-perf]"): wall time from play/seek
 * to the first audible sample, and the audio-clock gap between consecutive
 * chunks beyond the configured sentence pause. First-audio is split into
 * `load` (model load; ~0 when preloaded), `synth` (waiting on the first
 * audio; ~0 on a cache hit) and `wait` (the rest: resuming the audio context
 * and the output latency).
 */
let playRequestedAt = 0;
let firstAudioLoadMs = 0;
let firstAudioSynthMs = 0;
function notePerfStart(
	ctx: AudioContext,
	start: number,
	expected: number | null,
): void {
	if (expected === null) {
		const ms =
			performance.now() - playRequestedAt +
			Math.max(0, start - ctx.currentTime) * 1000;
		const wait = Math.max(0, ms - firstAudioLoadMs - firstAudioSynthMs);
		console.debug(
			`[tts-perf] first-audio ${ms.toFixed(0)}ms ` +
				`(load ${firstAudioLoadMs.toFixed(0)}, synth ${firstAudioSynthMs.toFixed(0)}, ` +
				`wait ${wait.toFixed(0)}; context ${ctx.sampleRate} Hz)`,
		);
	} else {
		console.debug(`[tts-perf] gap ${((start - expected) * 1000).toFixed(1)}ms`);
	}
}

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

let resampler: Worker | null = null;
let resampleSeq = 0;
const resamplePending = new Map<
	number,
	{ resolve: (pcm: Float32Array<ArrayBuffer>) => void; reject: (e: Error) => void }
>();

/** Resample in resampleWorker.ts; `pcm` is transferred (unusable afterwards). */
function resampleOffThread(
	pcm: Float32Array,
	from: number,
	to: number,
): Promise<Float32Array<ArrayBuffer>> {
	if (!resampler) {
		const w = new Worker(new URL("./resampleWorker.ts", import.meta.url), {
			type: "module",
		});
		w.onmessage = (event: MessageEvent) => {
			const { id, out, error } = event.data;
			const p = resamplePending.get(id);
			resamplePending.delete(id);
			if (error) p?.reject(new Error(error));
			else p?.resolve(out);
		};
		// A crash or an undecodable reply fails everything pending (a pending
		// promise would otherwise sit in the audio cache forever) and drops
		// the worker; the next call starts a fresh one.
		const fail = (message: string) => {
			for (const p of resamplePending.values()) p.reject(new Error(message));
			resamplePending.clear();
			w.terminate();
			if (resampler === w) resampler = null;
		};
		w.onerror = (e) => fail(e.message || "Resampler crashed");
		w.onmessageerror = () => fail("Resampler reply couldn't be read");
		resampler = w;
	}
	// Transfer only a buffer this view owns outright; copy anything else
	// (a view into a larger or shared buffer).
	const owned =
		pcm.buffer instanceof ArrayBuffer &&
		pcm.byteOffset === 0 &&
		pcm.byteLength === pcm.buffer.byteLength
			? pcm
			: pcm.slice();
	const id = ++resampleSeq;
	return new Promise((resolve, reject) => {
		resamplePending.set(id, { resolve, reject });
		resampler!.postMessage({ id, pcm: owned, from, to }, [owned.buffer]);
	});
}

async function pcmToBuffer(
	ctx: AudioContext,
	audio: Float32Array,
	sampleRate: number,
): Promise<AudioBuffer> {
	// Resample to the context's own rate ourselves so Chromium never resamples
	// the AudioBufferSource. On Linux its per-buffer resampler is broken — a
	// 24 kHz buffer in a 48 kHz context plays at 2× (chipmunk), and matching the
	// context to 24 kHz instead pushes a whistly artifact into the device output
	// resampler. Creating the buffer already at ctx.sampleRate avoids both.
	// Windowed sinc, not linear: linear interpolation leaves audible spectral
	// images above 12 kHz (a faint metallic sheen on every Linux sentence).
	// copyToChannel rejects a SharedArrayBuffer-backed view; the worker's
	// output never is one, and same-rate input is copied (rare: 24 kHz output).
	const data =
		sampleRate === ctx.sampleRate
			? audio.slice()
			: await resampleOffThread(audio, sampleRate, ctx.sampleRate);
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

/**
 * Synthesize the sentence the next press of play starts on, split exactly as
 * the loop's fast start splits it. Play then takes its normal fast-start path
 * and finds both parts in the cache: same split, same seam, same audio. The
 * run also absorbs the phonemizer, voice-file and GPU shader warm-up.
 */
function warmResumePosition(): void {
	const { playback, chunks, currentChunkIndex, voice, speed } =
		useTtsStore.getState();
	// Only with no loop alive. A paused loop already holds its audio; one that
	// was dropped by a seek while paused has nothing made for the new place.
	if (playback !== "idle" && !(playback === "paused" && !playbackLoopPromise)) {
		return;
	}
	// An export owns the engine; don't queue playback work between its chunks.
	// So does the benchmark (Settings), and extra work would skew its timings.
	if (isExportActive() || isBenchmarkRunning()) return;
	if (!activeEngine().activeBackend()) return;
	const text = chunks[currentChunkIndex]?.text;
	if (!text || !isSpeakableChunkText(text)) return;
	if (core.has(text, voice, speed) || core.inFlight(text, voice, speed)) return;
	// With no loop alive, the only playback jobs still queued are warm-ups for
	// places the listener has left: a new epoch makes the engine drop them.
	core.epoch++;
	const createsContext = !audioContext;
	prefetchTexts(splitForFastStart(text));
	// Making buffers needs a context but not a running one. Keep it suspended
	// until play, so an idle app doesn't hold the audio device open.
	if (createsContext) void audioContext?.suspend();
}

/**
 * Keep the resume position warm while nothing plays: once the model is
 * loaded, and again (debounced) whenever the position, voice, speed or engine
 * changes while idle or paused. Never loads a model itself. Returns the
 * function that stops it.
 */
export function startIdleWarm(): () => void {
	const update = createIdleWarmer(warmResumePosition);
	update(idleWarmKey(useTtsStore.getState()));
	const unsubscribe = useTtsStore.subscribe((s) => update(idleWarmKey(s)));
	return () => {
		unsubscribe();
		update(null);
	};
}

/**
 * Synthesize one chunk to raw PCM (for audiobook export). Null = nothing to
 * speak. `engineId` is the engine the export started with: a different
 * engine would take another voice set and sample rate, so that throws.
 */
export async function synthesizeChunkPcm(
	chunkText: string,
	voice: string,
	speed: number,
	engineId: string,
): Promise<{ audio: Float32Array; sampleRate: number } | null> {
	if (!isSpeakableChunkText(chunkText)) return null;
	if (activeEngine().id !== engineId) {
		throw new Error("The voice engine changed during the export.");
	}
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

/** Audio queued on the context clock; `ended` also settles on abort. */
type Scheduled = { start: number; end: number; ended: Promise<void> };

/**
 * Queue `buffer` to start at `when` on the audio clock (or as soon as possible
 * if that has passed), so consecutive chunks join sample-exactly instead of
 * waiting for an 'ended' event and a main-thread round trip.
 */
function scheduleBuffer(
	ctx: AudioContext,
	gain: GainNode,
	buffer: AudioBuffer,
	when: number,
	signal: AbortSignal,
): Scheduled {
	let resolveEnded!: () => void;
	const ended = new Promise<void>((r) => {
		resolveEnded = r;
	});
	// Removed once the audio ends: the loop's signal lives for a whole chapter,
	// and this closure's scope reaches the buffer and its source nodes.
	const onAbort = () => resolveEnded();
	signal.addEventListener("abort", onAbort, { once: true });

	// Split overlong buffers into sub-buffer sources, each under the Chromium
	// limit, overlapping + crossfading at the seams. stopActiveSource() stops
	// every scheduled source.
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
	// Build every slice BEFORE reading the clock so segment 0's start time is
	// never already in the past (clamped ≠ aligned — see SCHEDULE_HEADROOM_S).
	// Single-segment playback needs no alignment, so it keeps the zero-latency
	// start.
	const nodes = segments.map((seg) => {
		const src = ctx.createBufferSource();
		src.buffer = single
			? buffer
			: sliceBuffer(ctx, buffer, seg.start, seg.end - seg.start);
		return { seg, src };
	});
	const startTime = Math.max(
		when,
		ctx.currentTime + (single ? 0 : SCHEDULE_HEADROOM_S),
	);
	const mine: AudioBufferSourceNode[] = [];
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
				activeSources = activeSources.filter((s) => !mine.includes(s));
				signal.removeEventListener("abort", onAbort);
				resolveEnded();
			};
		}
		src.start(segStart);
		mine.push(src);
		activeSources.push(src);
	});
	return { start: startTime, end: startTime + total / rate, ended };
}

/**
 * Settles when the audio clock reaches `t` (or on abort). Driven by a silent
 * source on the audio thread, so a user pause (suspended context) holds it.
 */
function audioClockReaches(
	ctx: AudioContext,
	gain: GainNode,
	t: number,
	signal: AbortSignal,
): Promise<void> {
	if (signal.aborted || t <= ctx.currentTime) return Promise.resolve();
	return new Promise((resolve) => {
		const node = ctx.createConstantSource();
		node.offset.value = 0;
		node.connect(gain); // adds silence; connected so it is processed
		const done = () => {
			signal.removeEventListener("abort", done);
			node.onended = null;
			node.disconnect();
			resolve();
		};
		node.onended = done;
		signal.addEventListener("abort", done, { once: true });
		node.start();
		node.stop(t);
	});
}

/** Audio-clock span of the audio now playing and the share of its chunk it covers. */
let sweepSpan: { start: number; end: number; from: number; to: number } | null =
	null;

/**
 * Drive the in-sentence progress sweep from the audio clock while `live()`.
 * ctx.currentTime freezes while suspended (pause), so the sweep pauses for
 * free. No real per-token timing exists, so this is a duration-proportional
 * estimate.
 */
function runSweep(ctx: AudioContext, live: () => boolean): void {
	sweepSpan = null;
	const tick = () => {
		if (!live()) return;
		const s = sweepSpan;
		if (s) {
			const p =
				s.end > s.start
					? Math.min(1, Math.max(0, (ctx.currentTime - s.start) / (s.end - s.start)))
					: 0;
			useSweepStore.getState().setProgress(s.from + (s.to - s.from) * p);
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
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
	// A loop loading or suspended on the old engine would fail with "TTS engine
	// reset" / "Engine not ready"; restart it (or drop it while paused, so the
	// next resume starts fresh and loads the new engine).
	if (useTtsStore.getState().playback === "loading_model") {
		startPlaybackLoopFresh();
	} else {
		rescheduleForSeek();
	}
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
	playRequestedAt = performance.now();
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
	firstAudioLoadMs = performance.now() - playRequestedAt;

	const { ctx, gain } = getAudioGraph();
	applyVolumeFromStore();
	await ctx.resume();

	if (signal.aborted) return;

	let idx = useTtsStore.getState().currentChunkIndex;
	/**
	 * The audio playing now. The next chunk is synthesized meanwhile and queued
	 * on the audio clock at its end; the loop then waits for it to end, so at
	 * most one chunk is queued ahead.
	 */
	let playing: Scheduled | null = null;
	let coldStart = true;
	let live = true;
	runSweep(ctx, () => live && !signal.aborted);

	const showChunk = (i: number, playback: "playing" | "buffering") => {
		const c = useTtsStore.getState().chunks[i];
		if (!c) return;
		const paused = useTtsStore.getState().playback === "paused";
		useTtsStore.setState({
			...(paused ? {} : { playback }),
			currentChunkIndex: i,
			highlightRange: { start: c.start, end: c.end },
			progressPct: chunkProgressPct(i, useTtsStore.getState().chunks.length),
		});
	};

	try {
		while (!signal.aborted) {
			const snap = useTtsStore.getState();
			const { chunks } = snap;
			if (idx >= chunks.length) break;

			const chunk = chunks[idx];
			if (!chunk) break;

			// Already-synthesized chunks (prefetched, or revisited via seek) play
			// instantly; the audio cache keys on engine/voice/speed/rules/text, so
			// stale settings simply miss and re-synthesize.
			const cached = hasCachedChunkAudio(chunk.text, snap.voice, snap.speed);
			// Right after play or a seek, speak the chunk's first clause on its
			// own so audio starts after a short synthesis; the rest is made
			// while it plays. Not when the whole chunk is already being made
			// (e.g. "next" onto a running prefetch).
			const fastStart =
				coldStart &&
				!cached &&
				!core.inFlight(chunk.text, snap.voice, snap.speed);
			const parts = fastStart ? splitForFastStart(chunk.text) : [chunk.text];
			coldStart = false;
			const synthFrom = performance.now();
			const made = parts.map((text) =>
				synthesizeChunkBuffer(ctx, text, snap.voice, snap.speed),
			);
			for (const m of made) m.catch(() => {}); // awaited (and reported) in order below
			let chunkSec = 0;
			let doneChars = 0;

			for (let k = 0; k < parts.length; k++) {
				const prev: Scheduled | null = playing;
				let ready = false;
				if (!(k === 0 && cached)) {
					// Show "buffering" on this chunk once the audio before it runs out.
					const i = idx;
					void (prev?.ended ?? Promise.resolve()).then(() => {
						if (ready || signal.aborted) return;
						// Waiting on a fast-start tail: the sweep stays where the
						// head left it (its span clamps at `to`) instead of
						// jumping back to the sentence start.
						if (k === 0) {
							sweepSpan = null;
							useSweepStore.getState().setProgress(0);
						}
						showChunk(i, "buffering");
					});
				}

				let buffer: AudioBuffer | null = null;
				try {
					buffer = await made[k]!;
				} catch (e) {
					ready = true;
					// Let the sentence already playing finish.
					await prev?.ended;
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
				ready = true;
				if (signal.aborted) break;
				if (!prev) firstAudioSynthMs = performance.now() - synthFrom;

				const text = parts[k]!;
				const from = doneChars / chunk.text.length;
				doneChars += text.length;
				if (!buffer) continue;

				// Feed the listen-time estimate with the measured chars→audio rate,
				// and pin this chunk's exact length for the elapsed/total clock.
				useListenEstimateStore
					.getState()
					.recordSample(text.length, buffer.duration, snap.speed);
				chunkSec += buffer.duration;
				if (k === parts.length - 1) {
					useTtsStore.getState().recordChunkBaseSec(idx, chunkSec * snap.speed);
				}

				// Warm the cache for upcoming chunks so playback never waits on
				// synthesis, even when the current chunk is short.
				if (k === 0) {
					prefetchChunks(ctx, chunks, idx + 1, snap.voice, snap.speed, signal);
				}

				// Breathing room between sentences, on the audio clock (a user
				// pause freezes it too); none between parts of one chunk.
				const pause =
					k === 0 ? useTtsStore.getState().sentencePauseMs / 1000 : 0;
				const expected = prev ? prev.end + pause : null;
				const next = scheduleBuffer(ctx, gain, buffer, expected ?? 0, signal);
				notePerfStart(ctx, next.start, expected);
				if (prev) await prev.ended;
				// Keep the highlight on the sentence just spoken through the pause.
				await audioClockReaches(ctx, gain, next.start, signal);
				if (signal.aborted) break;
				playing = next;
				sweepSpan = {
					start: next.start,
					end: next.end,
					from: Math.min(1, from),
					to: Math.min(1, doneChars / chunk.text.length),
				};
				showChunk(idx, "playing");
			}
			idx += 1;
		}
		// Let the last queued chunk play out.
		if (!signal.aborted) await playing?.ended;
	} finally {
		live = false;
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
	// The benchmark (Settings) is loading and unloading the engine.
	if (isBenchmarkRunning()) return;

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
