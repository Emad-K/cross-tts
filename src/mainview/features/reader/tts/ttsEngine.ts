import { KokoroTTS } from "kokoro-js";
import { KOKORO_MODEL_ID, type KokoroVoiceId } from "./kokoroVoices";
import { prefetchAllVoiceBins } from "./prefetchKokoroAssets";
import { useTtsStore } from "./ttsStore";

type TtsAudio = Awaited<ReturnType<KokoroTTS["generate"]>>;

let ttsInstance: KokoroTTS | null = null;
let loadPromise: Promise<KokoroTTS> | null = null;

let audioContext: AudioContext | null = null;
let gainNode: GainNode | null = null;
let activeSource: AudioBufferSourceNode | null = null;

let playbackAbort: AbortController | null = null;
let playbackLoopPromise: Promise<void> | null = null;

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
		loadPromise = KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
			dtype: "q8",
			device: "wasm",
			progress_callback: (info) => {
				if (info.status === "progress") {
					setModelProgress(info.progress / 100);
				}
			},
		})
			.then((tts) => {
				ttsInstance = tts;
				setVoiceOptions(voiceOptionsFromTts(tts));
				setModelPhase("ready");
				setModelProgress(1);
				return tts;
			})
			.catch((e: unknown) => {
				loadPromise = null;
				const msg = e instanceof Error ? e.message : String(e);
				setModelPhase("error", msg);
				throw e;
			});
	}
	return loadPromise;
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
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		setVoiceDownload("error", {
			voiceDownloadError: msg,
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

	useTtsStore.setState({ playback: "playing" });

	let idx = useTtsStore.getState().currentChunkIndex;
	const durations: number[] = [];

	while (!signal.aborted) {
		const snap = useTtsStore.getState();
		const { chunks } = snap;
		if (idx >= chunks.length) break;

		const chunk = chunks[idx];
		if (!chunk) break;

		useTtsStore.setState({
			currentChunkIndex: idx,
			highlightRange: { start: chunk.start, end: chunk.end },
		});

		let raw: TtsAudio;
		try {
			raw = await tts.generate(chunk.text, {
				voice: snap.voice,
				speed: snap.speed,
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			useTtsStore.setState({ playback: "idle", playbackError: msg });
			return;
		}

		if (signal.aborted) break;

		const buffer = rawToBuffer(ctx, raw);
		durations[idx] = buffer.duration;

		const sumPrev = durations
			.slice(0, idx)
			.reduce((a, b) => a + (b ?? 0), 0);
		const rest = chunks.length - idx - 1;
		const known = durations.filter((d) => d > 0);
		const avg =
			known.length > 0
				? known.reduce((a, b) => a + b, 0) / known.length
				: buffer.duration;
		const totalEst = sumPrev + buffer.duration + rest * avg;

		const startedAt = ctx.currentTime;
		let raf = 0;
		const tick = () => {
			if (signal.aborted) return;
			const st = useTtsStore.getState();
			if (st.playback !== "playing") return;
			const playedNow = Math.min(
				buffer.duration,
				Math.max(0, ctx.currentTime - startedAt),
			);
			const elapsed = sumPrev + playedNow;
			const pct = totalEst > 0 ? (elapsed / totalEst) * 100 : 0;
			useTtsStore.setState({
				elapsedSec: elapsed,
				totalSec: totalEst,
				progressPct: Math.min(100, pct),
			});
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);

		await playBuffer(ctx, gain, buffer, signal);
		cancelAnimationFrame(raf);

		if (signal.aborted) break;

		idx += 1;
		useTtsStore.setState({ currentChunkIndex: idx });
	}

	const snap = useTtsStore.getState();
	if (!signal.aborted && idx >= snap.chunks.length) {
		useTtsStore.setState({
			playback: "idle",
			currentChunkIndex: 0,
			highlightRange: null,
			elapsedSec: 0,
			totalSec: null,
			progressPct: 0,
		});
	} else if (!signal.aborted) {
		useTtsStore.setState({ playback: "idle" });
	}
}

export async function startOrResumePlayback(): Promise<void> {
	const { playback, chunks } = useTtsStore.getState();
	if (chunks.length === 0) return;

	if (playback === "playing" || playback === "loading_model") return;

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
	if (useTtsStore.getState().playback !== "playing") return;
	interruptPlaybackForReschedule();
	const ab = new AbortController();
	playbackAbort = ab;
	playbackLoopPromise = runPlaybackLoop(ab.signal);
	void playbackLoopPromise;
}

export async function togglePlayPause(): Promise<void> {
	const { playback } = useTtsStore.getState();
	if (playback === "playing") {
		await pausePlayback();
		return;
	}
	await startOrResumePlayback();
}

export function seekToChunkAndMaybePlay(index: number): void {
	const { playback, seekToChunk } = useTtsStore.getState();
	seekToChunk(index);
	if (playback === "playing") {
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
	const idx = Math.min(
		chunks.length - 1,
		Math.floor((clamped / 100) * chunks.length),
	);
	seekToChunk(idx);
	if (useTtsStore.getState().playback === "playing") {
		interruptPlaybackForReschedule();
		const ab = new AbortController();
		playbackAbort = ab;
		playbackLoopPromise = runPlaybackLoop(ab.signal);
		void playbackLoopPromise;
	} else {
		useTtsStore.setState({ progressPct: clamped });
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
	if (useTtsStore.getState().playback === "playing") {
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
