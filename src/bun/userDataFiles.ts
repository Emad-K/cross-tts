import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { coerceNotesFile } from "../shared/notes";
import { coerceReadingStats } from "../shared/readingStats";
import { backupUnreadableFile, writeFileAtomic } from "./atomicFile";

/**
 * Small per-user JSON files kept beside the session file. They are separate
 * from it because the session is rewritten every 2 s during playback.
 * The renderer can only name a file from this list, never a path.
 */
const USER_DATA_FILES = {
	notes: { file: "notes.json", coerce: coerceNotesFile },
	stats: { file: "reading-stats.json", coerce: coerceReadingStats },
} as const;

export type UserDataName = keyof typeof USER_DATA_FILES;

/** Largest user-data file read or written, and largest text export. */
export const MAX_USER_DATA_BYTES = 20 * 1024 * 1024;

function entryFor(name: unknown) {
	if (typeof name !== "string" || !Object.hasOwn(USER_DATA_FILES, name)) {
		throw new Error("Unknown user data file.");
	}
	return USER_DATA_FILES[name as UserDataName];
}

/** Read and validate one user-data file; null when it doesn't exist or is unreadable. */
export function readUserDataFile(dir: string, name: unknown): unknown {
	const { file, coerce } = entryFor(name);
	const path = join(dir, file);
	if (!existsSync(path)) return null;
	try {
		if (statSync(path).size > MAX_USER_DATA_BYTES) {
			throw new Error("file is too large");
		}
		return coerce(JSON.parse(readFileSync(path, "utf8")));
	} catch (err) {
		// The next save replaces this file, so keep a copy first.
		const bak = backupUnreadableFile(path);
		console.error(`[user-data] unreadable ${path}, backed up to ${bak}:`, err);
		return null;
	}
}

/** Validate and atomically write one user-data file. */
export function writeUserDataFile(dir: string, name: unknown, data: unknown): void {
	const { file, coerce } = entryFor(name);
	const json = JSON.stringify(coerce(data));
	if (Buffer.byteLength(json) > MAX_USER_DATA_BYTES) {
		throw new Error("This is too much data to save.");
	}
	mkdirSync(dir, { recursive: true });
	writeFileAtomic(join(dir, file), json);
}
