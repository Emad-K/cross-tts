import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import { getKokoroHubBaseUrl } from "@/lib/electrobunRpc";
import { setKokoroHubBaseUrl } from "./kokoroHubConfig";
import { KOKORO_MODEL_ID, type KokoroVoiceId } from "./kokoroVoices";
import { prefetchAllVoiceBins } from "./prefetchKokoroAssets";
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

let audioContext: AudioContext | null = null;
let gainNode: GainNode | null = null;
let activeSource: AudioBufferSourceNode | null = null;

let playbackAbort: AbortController | null = null;
let playbackLoopPromise: Promise<void> | null = null;

type KokoroFromPretrainedDtype = NonNullable<
	Parameters<typeof KokoroTTS.from_pretrained>[1]
>["dtype"];

/**
 * Kokoro-js `device: "webgpu"` uses the **webview** standard WebGPU API
 * (`navigator.gpu` + ONNX Runtime WebGPU EP). That is separate from Electrobun's
 * Bun-side Dawn bundle (`build.*.bundleWGPU`, `GpuWindow`, `webgpu` from
 * `electrobun/bun`), which does not inject a GPU into page JS.
 *
 * Official kokoro-js note: with `device: "webgpu"`, use `dtype: "fp32"` — q8 on
 * WebGPU can give bad / garbage-sounding output.
 */
async function resolveKokoroLoadOptions(): Promise<{
	device: "webgpu" | "wasm";
	dtype: KokoroFromPretrainedDtype;
}> {
	let device: "webgpu" | "wasm" = "wasm";
	try {
		if (typeof navigator !== "undefined" && navigator.gpu) {
			const adapter = await navigator.gpu.requestAdapter();
			if (adapter) device = "webgpu";
		}
	} catch {
		device = "wasm";
	}
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
		loadPromise = ensureKokoroHubEnv()
			.then(() => resolveKokoroLoadOptions())
			.then(({ device, dtype }) =>
			KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
				dtype,
				device,
				progress_callback: (info) => {
					if (info.status === "progress") {
						setModelProgress(info.progress / 100);
					}
				},
			}),
		)
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

	let idx = useTtsStore.getState().currentChunkIndex;
	let nextPrefetchIdx: number | null = null;
	let nextPrefetchBuffer: AudioBuffer | null = null;

	while (!signal.aborted) {
		const snap = useTtsStore.getState();
		const { chunks } = snap;
		if (idx >= chunks.length) break;

		const chunk = chunks[idx];
		if (!chunk) break;

		const total = chunks.length;

		if (nextPrefetchIdx !== null && nextPrefetchIdx !== idx) {
			nextPrefetchIdx = null;
			nextPrefetchBuffer = null;
		}

		const usedPrefetch =
			nextPrefetchIdx === idx && nextPrefetchBuffer !== null;

		useTtsStore.setState({
			playback: usedPrefetch ? "playing" : "buffering",
			currentChunkIndex: idx,
			highlightRange: { start: chunk.start, end: chunk.end },
			progressPct: chunkProgressPct(idx, total),
			elapsedSec: idx,
			totalSec: total,
		});

		let buffer: AudioBuffer;
		if (usedPrefetch && nextPrefetchBuffer) {
			buffer = nextPrefetchBuffer;
			nextPrefetchIdx = null;
			nextPrefetchBuffer = null;
		} else {
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

			buffer = rawToBuffer(ctx, raw);
		}

		if (signal.aborted) break;

		if (idx + 1 < chunks.length) {
			const nextIndex = idx + 1;
			const nextCh = chunks[nextIndex]!;
			const voice = snap.voice;
			const speed = snap.speed;
			const nextTextSnapshot = nextCh.text;
			void tts
				.generate(nextCh.text, { voice, speed })
				.then((r) => {
					if (signal.aborted) return;
					const st = useTtsStore.getState();
					const ch = st.chunks[nextIndex];
					if (
						!ch ||
						ch.text !== nextTextSnapshot ||
						st.voice !== voice ||
						st.speed !== speed
					) {
						return;
					}
					try {
						nextPrefetchIdx = nextIndex;
						nextPrefetchBuffer = rawToBuffer(ctx, r);
					} catch {
						nextPrefetchIdx = null;
						nextPrefetchBuffer = null;
					}
				})
				.catch(() => {});
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
