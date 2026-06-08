import { create } from "zustand";

/**
 * Audiobook-export state, split out from exportEngine so lightweight callers
 * (e.g. the reader's shortcut guard) can read it without pulling in the MP3
 * encoder and TTS engine that exportEngine imports.
 */
export type ExportPhase =
	| "idle"
	| "preparing"
	| "running"
	| "paused"
	| "done"
	| "cancelled"
	| "error";

export type ExportState = {
	phase: ExportPhase;
	totalChunks: number;
	doneChunks: number;
	totalChapters: number;
	currentChapterIndex: number;
	currentChapterTitle: string;
	etaSeconds: number | null;
	filesWritten: number;
	/** Chapters skipped because their file already existed (resumed export). */
	skippedChapters: number;
	outputDir: string | null;
	error: string | null;
};

export const INITIAL_EXPORT_STATE: ExportState = {
	phase: "idle",
	totalChunks: 0,
	doneChunks: 0,
	totalChapters: 0,
	currentChapterIndex: 0,
	currentChapterTitle: "",
	etaSeconds: null,
	filesWritten: 0,
	skippedChapters: 0,
	outputDir: null,
	error: null,
};

export const useExportStore = create<ExportState>(() => ({
	...INITIAL_EXPORT_STATE,
}));

/** True while an export is preparing, running, or paused (blocks other actions). */
export function isExportActive(): boolean {
	const p = useExportStore.getState().phase;
	return p === "preparing" || p === "running" || p === "paused";
}
