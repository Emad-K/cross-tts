import {
	copyFileSync,
	existsSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";

/**
 * Write via a temp file + rename so a crash mid-write never leaves a truncated
 * file behind (same pattern as modelDownload.ts).
 */
export function writeFileAtomic(path: string, data: string): void {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, data);
	renameSync(tmp, path);
}

/**
 * Keep a copy of a file we failed to parse before the app's next save replaces
 * it with defaults. Named after the file's mtime, so repeated loads of the same
 * broken file don't pile up copies. Returns the backup path, or null.
 */
export function backupUnreadableFile(path: string): string | null {
	try {
		const bak = `${path}.corrupt-${Math.floor(statSync(path).mtimeMs)}.bak`;
		if (!existsSync(bak)) copyFileSync(path, bak);
		return bak;
	} catch {
		return null;
	}
}
