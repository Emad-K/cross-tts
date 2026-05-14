import { create } from "zustand";
import { buildTtsChunks, normalizedReaderText } from "./chunkText";
import type { TtsChunk } from "./chunkText";
import type { KokoroVoiceId } from "./kokoroVoices";

export type ModelPhase = "idle" | "loading" | "ready" | "error";
export type VoiceDownloadPhase = "idle" | "running" | "done" | "error";
export type PlaybackPhase = "idle" | "loading_model" | "playing" | "paused";

export type VoiceOption = { id: KokoroVoiceId; label: string };

type TtsState = {
	sourceText: string;
	chunks: TtsChunk[];
	voiceOptions: VoiceOption[];
	voice: KokoroVoiceId;
	volumePct: number;
	speed: number;
	modelPhase: ModelPhase;
	modelError: string | null;
	modelProgress: number | null;
	voiceDownloadPhase: VoiceDownloadPhase;
	voiceDownloadError: string | null;
	voiceDownloadProgress: { loaded: number; total: number } | null;
	playback: PlaybackPhase;
	playbackError: string | null;
	currentChunkIndex: number;
	highlightRange: { start: number; end: number } | null;
	elapsedSec: number;
	totalSec: number | null;
	progressPct: number;
	setSourceText: (raw: string) => void;
	setVoiceOptions: (opts: VoiceOption[]) => void;
	setVoice: (id: KokoroVoiceId) => void;
	setVolumePct: (v: number) => void;
	setSpeed: (s: number) => void;
	setModelPhase: (p: ModelPhase, err?: string | null) => void;
	setModelProgress: (v: number | null) => void;
	setVoiceDownload: (
		phase: VoiceDownloadPhase,
		extra?: Partial<
			Pick<TtsState, "voiceDownloadProgress" | "voiceDownloadError">
		>,
	) => void;
	setPlayback: (
		patch: Partial<
			Pick<
				TtsState,
				| "playback"
				| "playbackError"
				| "currentChunkIndex"
				| "highlightRange"
				| "elapsedSec"
				| "totalSec"
				| "progressPct"
			>
		>,
	) => void;
	seekToChunk: (index: number) => void;
};

const initialVoice: KokoroVoiceId = "af_heart";

export const useTtsStore = create<TtsState>((set, get) => ({
	sourceText: "",
	chunks: [],
	voiceOptions: [],
	voice: initialVoice,
	volumePct: 80,
	speed: 1,
	modelPhase: "idle",
	modelError: null,
	modelProgress: null,
	voiceDownloadPhase: "idle",
	voiceDownloadError: null,
	voiceDownloadProgress: null,
	playback: "idle",
	playbackError: null,
	currentChunkIndex: 0,
	highlightRange: null,
	elapsedSec: 0,
	totalSec: null,
	progressPct: 0,

	setSourceText: (raw) => {
		const normalized = normalizedReaderText(raw);
		const chunks = buildTtsChunks(raw);
		set({
			sourceText: normalized,
			chunks,
			currentChunkIndex: 0,
			highlightRange: null,
			elapsedSec: 0,
			totalSec: null,
			progressPct: 0,
			playback: "idle",
			playbackError: null,
		});
	},

	setVoiceOptions: (voiceOptions) => set({ voiceOptions }),

	setVoice: (id) => {
		set({ voice: id });
	},

	setVolumePct: (v) => set({ volumePct: Math.round(Math.min(100, Math.max(0, v))) }),

	setSpeed: (s) => set({ speed: Math.min(2, Math.max(0.5, s)) }),

	setModelPhase: (modelPhase, err = null) =>
		set({
			modelPhase,
			modelError: modelPhase === "error" ? (err ?? "Model error") : null,
			...(modelPhase === "ready" ? { modelProgress: 1 } : {}),
		}),

	setModelProgress: (modelProgress) => set({ modelProgress }),

	setVoiceDownload: (voiceDownloadPhase, extra) =>
		set({
			voiceDownloadPhase,
			...extra,
		}),

	setPlayback: (patch) => set(patch),

	seekToChunk: (index) => {
		const { chunks } = get();
		if (chunks.length === 0) return;
		const clamped = Math.max(0, Math.min(chunks.length - 1, index));
		const ch = chunks[clamped];
		set({
			currentChunkIndex: clamped,
			highlightRange: { start: ch.start, end: ch.end },
			progressPct: (clamped / chunks.length) * 100,
		});
	},
}));
