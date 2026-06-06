import type { Bookmark } from "./bookmarks";
import type { BookProgress } from "./recentBooks";
import type { TtsTextRulesState } from "./ttsTextRules";
import { defaultTtsTextRulesState } from "./ttsTextRules";

/** Persisted UI session (v1). Kept in shared so Bun + webview stay aligned. */
export const APP_SESSION_VERSION = 1;

export type StoredWindowFrame = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type WebPersistedSlice = {
	voice: string;
	volumePct: number;
	speed: number;
	/** Absolute path to the open document; content is read on demand, not stored in session. */
	documentPath: string | null;
	/** Active EPUB chapter manifest id; null for .txt or unknown. */
	activeChapterId: string | null;
	currentChunkIndex: number;
	/** Regex and pronunciation transforms applied at TTS synthesis time. */
	ttsTextRules: TtsTextRulesState;
	/** Recently-opened books keyed by path, for the library + per-book resume. */
	books: Record<string, BookProgress>;
	/** Saved spots keyed by document path. */
	bookmarks: Record<string, Bookmark[]>;
};

export type AppSessionFileV1 = {
	version: typeof APP_SESSION_VERSION;
	/** Normal (un-maximized) bounds, so a maximized window restores correctly. */
	window: StoredWindowFrame | null;
	/** Window was maximized when last saved. */
	maximized: boolean;
	/** Window was in fullscreen when last saved. */
	fullScreen: boolean;
	web: WebPersistedSlice;
};

export const defaultWebPersistedSlice = (): WebPersistedSlice => ({
	voice: "af_heart",
	volumePct: 80,
	speed: 1,
	documentPath: null,
	activeChapterId: null,
	currentChunkIndex: 0,
	ttsTextRules: defaultTtsTextRulesState(),
	books: {},
	bookmarks: {},
});
