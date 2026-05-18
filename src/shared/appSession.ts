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
	/** Absolute path to the open .txt file; content is read on demand, not stored in session. */
	documentPath: string | null;
	currentChunkIndex: number;
};

export type AppSessionFileV1 = {
	version: typeof APP_SESSION_VERSION;
	window: StoredWindowFrame | null;
	web: WebPersistedSlice;
};

export const defaultWebPersistedSlice = (): WebPersistedSlice => ({
	voice: "af_heart",
	volumePct: 80,
	speed: 1,
	documentPath: null,
	currentChunkIndex: 0,
});
