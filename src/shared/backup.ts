import { type Appearance, coerceAppearance } from "./appearance";
import { type Bookmark, coerceBookmarksByPath } from "./bookmarks";
import { type BookProgress, coerceRecentBooks } from "./recentBooks";
import { type ShortcutBindings, coerceShortcutBindings } from "./shortcuts";
import {
	type RegexReplaceRule,
	type TtsTextRulesState,
	coerceTtsTextRulesState,
	defaultTtsTextRulesState,
	isValidRegexPattern,
} from "./ttsTextRules";
import { coerceWatchedFolders } from "./watchedFolders";

/**
 * Backup file: one JSON document with the library (book paths, reading
 * positions, per-book voice), bookmarks, text rules and settings, plus notes
 * and listening stats as whole files under `extra`. Models,
 * caches, the data folder location and hardware settings are left out: they
 * belong to the machine, not the reader. A backup is untrusted input when it
 * comes back: everything is rebuilt field by field, nothing is executed.
 */
export const BACKUP_FORMAT = "cross-tts-backup";
export const BACKUP_VERSION = 1;
/** Largest backup file Restore reads. */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export type BackupSettings = {
	appearance: Appearance;
	shortcuts: ShortcutBindings;
	shortcutsEnabled: boolean;
	watchedFolders: string[];
	keepPlayingInBackground: boolean;
};

/** The part of a backup that lives in the renderer's stores. */
export type BackupLibrary = {
	books: Record<string, BookProgress>;
	bookmarks: Record<string, Bookmark[]>;
	rules: TtsTextRulesState;
};

export type BackupFile = BackupLibrary & {
	format: typeof BACKUP_FORMAT;
	version: typeof BACKUP_VERSION;
	/** ISO date the backup was made. */
	createdAt: string;
	appVersion: string;
	/** Null when the file carries no settings. */
	settings: BackupSettings | null;
	/** Other data files by key (see EXTRA_BACKUP_FILES in src/bun/backup.ts). */
	extra: Record<string, unknown>;
};

export type BackupSummary = {
	books: number;
	bookmarks: number;
	/** Rules the user added (built-in rules aren't counted). */
	rules: number;
	createdAt: string;
};

export type RestoreMode = "merge" | "replace";

function isRecord(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Rules as a backup may carry them. Built-in regex rules keep only their
 * on/off switch (the pattern always comes from this app, never the file), and
 * nothing else can claim to be built in.
 */
function sanitizeRules(raw: unknown): TtsTextRulesState {
	const defaults = defaultTtsTextRulesState();
	const builtinRegex = new Map(defaults.regexRules.map((r) => [r.id, r]));
	const builtinPron = new Set(defaults.pronunciationRules.map((r) => r.id));
	const state = coerceTtsTextRulesState(raw);
	return {
		regexRules: state.regexRules.flatMap((r): RegexReplaceRule[] => {
			const builtin = builtinRegex.get(r.id);
			if (builtin) return [{ ...builtin, enabled: r.enabled }];
			if (!isValidRegexPattern(r.pattern)) return [];
			return [{ ...r, builtIn: false, group: undefined }];
		}),
		pronunciationRules: state.pronunciationRules.map((r) =>
			builtinPron.has(r.id) ? r : { ...r, builtIn: false, group: undefined },
		),
	};
}

function sanitizeLibrary(raw: Record<string, unknown>): BackupLibrary {
	return {
		books: coerceRecentBooks(raw.books),
		bookmarks: coerceBookmarksByPath(raw.bookmarks),
		rules: sanitizeRules(raw.rules),
	};
}

export function buildBackup(o: {
	/** As sent by the renderer; validated here. */
	library: unknown;
	settings: BackupSettings;
	extra: Record<string, unknown>;
	appVersion: string;
	now: Date;
}): BackupFile {
	return {
		format: BACKUP_FORMAT,
		version: BACKUP_VERSION,
		createdAt: o.now.toISOString(),
		appVersion: o.appVersion,
		...sanitizeLibrary(isRecord(o.library) ? o.library : {}),
		settings: o.settings,
		extra: o.extra,
	};
}

export type ParseBackupResult =
	| { ok: true; data: BackupFile }
	| { ok: false; error: string };

const NOT_A_BACKUP = "This file isn't a Cross TTS backup.";

/** Validate a backup file's text. Unknown or malformed parts are dropped. */
export function parseBackup(json: string): ParseBackupResult {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return { ok: false, error: NOT_A_BACKUP };
	}
	if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
		return { ok: false, error: NOT_A_BACKUP };
	}
	if (typeof raw.version !== "number" || raw.version < 1) {
		return { ok: false, error: NOT_A_BACKUP };
	}
	if (raw.version > BACKUP_VERSION) {
		return {
			ok: false,
			error:
				"This backup was made by a newer version of Cross TTS. Update the app, then restore it again.",
		};
	}
	const s = raw.settings;
	return {
		ok: true,
		data: {
			format: BACKUP_FORMAT,
			version: BACKUP_VERSION,
			createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
			appVersion: typeof raw.appVersion === "string" ? raw.appVersion : "",
			...sanitizeLibrary(raw),
			settings: isRecord(s)
				? {
						appearance: coerceAppearance(s.appearance),
						shortcuts: coerceShortcutBindings(s.shortcuts),
						shortcutsEnabled: s.shortcutsEnabled === true,
						watchedFolders: coerceWatchedFolders(s.watchedFolders),
						keepPlayingInBackground: s.keepPlayingInBackground === true,
					}
				: null,
			extra: isRecord(raw.extra) ? raw.extra : {},
		},
	};
}

export function backupSummary(data: BackupFile): BackupSummary {
	return {
		books: Object.keys(data.books).length,
		bookmarks: Object.values(data.bookmarks).reduce((n, l) => n + l.length, 0),
		rules:
			data.rules.regexRules.filter((r) => !r.builtIn).length +
			data.rules.pronunciationRules.filter((r) => !r.builtIn).length,
		createdAt: data.createdAt,
	};
}

/** Per book the more recently read entry wins; tags and series are kept. */
function mergeBooks(
	current: Record<string, BookProgress>,
	incoming: Record<string, BookProgress>,
): Record<string, BookProgress> {
	const out = { ...current };
	for (const [path, theirs] of Object.entries(incoming)) {
		const mine = out[path];
		if (!mine) {
			out[path] = theirs;
			continue;
		}
		const [win, lose] =
			theirs.updatedAt > mine.updatedAt ? [theirs, mine] : [mine, theirs];
		out[path] = {
			...win,
			series: win.series ?? lose.series,
			tags: win.tags ?? lose.tags,
		};
	}
	// Caps the list at the library limit, most recently read first.
	return coerceRecentBooks(out);
}

function mergeBookmarks(
	current: Record<string, Bookmark[]>,
	incoming: Record<string, Bookmark[]>,
): Record<string, Bookmark[]> {
	const out = { ...current };
	for (const [path, theirs] of Object.entries(incoming)) {
		const mine = out[path] ?? [];
		const ids = new Set(mine.map((b) => b.id));
		out[path] = [...mine, ...theirs.filter((b) => !ids.has(b.id))];
	}
	return out;
}

const regexKey = (r: RegexReplaceRule) => `${r.caseSensitive}:${r.pattern}`;

/**
 * Combine what the app holds with a backup. "replace" takes the backup as it
 * is; "merge" keeps everything here and adds what the backup has on top.
 *
 * A custom regex rule runs on every sentence and a bad pattern can freeze the
 * app, so (as with imported rule files) one that isn't already running here
 * comes in switched off for the user to review. `rulesSwitchedOff` counts them.
 */
export function mergeBackup(
	current: BackupLibrary,
	incoming: BackupLibrary,
	mode: RestoreMode,
): BackupLibrary & { rulesSwitchedOff: number } {
	const running = new Set(
		current.rules.regexRules.filter((r) => r.enabled).map(regexKey),
	);
	let rulesSwitchedOff = 0;
	const reviewed = (r: RegexReplaceRule): RegexReplaceRule => {
		if (r.builtIn || !r.enabled || running.has(regexKey(r))) return r;
		rulesSwitchedOff++;
		return { ...r, enabled: false };
	};

	if (mode === "replace") {
		return {
			books: incoming.books,
			bookmarks: incoming.bookmarks,
			rules: {
				regexRules: incoming.rules.regexRules.map(reviewed),
				pronunciationRules: incoming.rules.pronunciationRules,
			},
			rulesSwitchedOff,
		};
	}

	const regexIds = new Set(current.rules.regexRules.map((r) => r.id));
	const pronIds = new Set(current.rules.pronunciationRules.map((r) => r.id));
	return {
		books: mergeBooks(current.books, incoming.books),
		bookmarks: mergeBookmarks(current.bookmarks, incoming.bookmarks),
		rules: {
			regexRules: [
				...current.rules.regexRules,
				...incoming.rules.regexRules
					.filter((r) => !regexIds.has(r.id))
					.map(reviewed),
			],
			pronunciationRules: [
				...current.rules.pronunciationRules,
				...incoming.rules.pronunciationRules.filter((r) => !pronIds.has(r.id)),
			],
		},
		rulesSwitchedOff,
	};
}

export function backupFileName(date: Date): string {
	return `cross-tts-backup-${date.toISOString().slice(0, 10)}.json`;
}

/** Result of "Back up…": what was written, or why it failed. */
export type BackupExportResult =
	| { filePath: string; summary: BackupSummary }
	| { error: string };

/** Result of picking a backup to restore: its validated contents, or why not. */
export type BackupPickResult =
	| {
			fileName: string;
			library: BackupLibrary;
			summary: BackupSummary;
			/** Books in the backup whose files aren't on this computer. */
			missingPaths: string[];
	  }
	| { error: string };
