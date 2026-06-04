import type { BrowserWindow } from "electron";
import type { ForwardedLogEntry, LogEntryInput } from "../shared/logEntry";

/**
 * Main-process logging that also forwards entries to the renderer's in-app log
 * panel over IPC (channel "app:log"). Entries logged before a window exists (or
 * before its renderer finished loading) still reach the terminal via console.
 */
let target: BrowserWindow | null = null;

export function setLogTarget(win: BrowserWindow | null): void {
	target = win;
}

export function mainLog(entry: LogEntryInput): void {
	const source = entry.source ?? "main";
	const line = `[${source}] ${entry.message}${entry.detail ? ` — ${entry.detail}` : ""}`;
	if (entry.level === "error") console.error(line);
	else if (entry.level === "warn") console.warn(line);
	else console.log(line);

	const full: ForwardedLogEntry = { ...entry, source, ts: Date.now() };
	const wc = target?.webContents;
	if (!wc || wc.isDestroyed()) return;
	if (wc.isLoading()) {
		wc.once("did-finish-load", () => {
			if (!wc.isDestroyed()) wc.send("app:log", full);
		});
	} else {
		wc.send("app:log", full);
	}
}
