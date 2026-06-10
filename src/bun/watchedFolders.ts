import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { isSupportedDocumentName } from "../shared/droppedFiles";
import type { WatchedFileCandidate } from "../shared/watchedFolders";
import { watchedFolders } from "./appConfigStore";

/**
 * Watched-folder scanner. No file-system watcher (and no chokidar): watched
 * directories are re-scanned **one level deep** (the folder itself plus its
 * immediate subdirectories — enough for `Books/Author/book.epub` layouts) on:
 *
 * - app start (the renderer pulls a snapshot via `getWatchedFileCandidates`
 *   once it has subscribed, so no event is lost during boot),
 * - a folder being added in Settings,
 * - window focus,
 * - a 60 s interval while a window exists.
 *
 * Each scan pushes the **full** found-file list as `app:watched-files`
 * (same setTarget + webContents.send pattern as `app:update-status`); the
 * renderer dedupes against its library and an in-session seen-set.
 */

const SCAN_INTERVAL_MS = 60_000;

let targetWindow: BrowserWindow | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const onFocus = () => pushWatchedFiles();

/** Files matching a supported document extension, one level deep. */
function scanDir(dir: string, depth: number): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return []; // Missing/unreadable folder: nothing to report this round.
	}
	const out: string[] = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isFile() && isSupportedDocumentName(entry.name)) {
			out.push(full);
		} else if (entry.isDirectory() && depth > 0) {
			out.push(...scanDir(full, depth - 1));
		}
	}
	return out;
}

/** Scan every watched folder now and return the full candidate snapshot. */
export function scanWatchedFolders(): WatchedFileCandidate[] {
	const seen = new Set<string>();
	const out: WatchedFileCandidate[] = [];
	for (const dir of watchedFolders()) {
		for (const path of scanDir(dir, 1)) {
			if (seen.has(path)) continue;
			seen.add(path);
			out.push({ path });
		}
	}
	return out;
}

/** Scan and push the snapshot to the target window (no-op without one). */
export function pushWatchedFiles(): void {
	if (!targetWindow) return;
	const candidates = scanWatchedFolders();
	try {
		targetWindow.webContents.send("app:watched-files", candidates);
	} catch {
		// Window may be mid-teardown; the renderer re-pulls on next mount.
	}
}

/**
 * Window that receives `app:watched-files` events. Setting a window starts
 * the focus listener and 60 s rescan loop; clearing it (on close) stops both.
 */
export function setWatchedFilesTarget(win: BrowserWindow | null): void {
	if (targetWindow && !targetWindow.isDestroyed()) {
		targetWindow.removeListener("focus", onFocus);
	}
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
	targetWindow = win;
	if (win) {
		win.on("focus", onFocus);
		timer = setInterval(pushWatchedFiles, SCAN_INTERVAL_MS);
	}
}
