/**
 * App log entry shape, shared by the Electron main process (which forwards its
 * logs to the renderer over IPC) and the renderer's in-app log panel.
 */
export type LogLevel = "info" | "warn" | "error";

export type LogEntryInput = {
	level: LogLevel;
	message: string;
	/** Optional secondary line: a stack, an error message, a file path. */
	detail?: string;
	/** Origin tag, e.g. "tts", "storage", "main". */
	source?: string;
};

export type LogEntry = LogEntryInput & {
	id: string;
	/** Epoch milliseconds when the entry was recorded. */
	ts: number;
};

/** Log payload forwarded over IPC; the renderer assigns the local `id`. */
export type ForwardedLogEntry = LogEntryInput & { ts: number };
