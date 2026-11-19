import { readFileSync } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { type BrowserWindow, app, dialog, ipcMain } from "electron";
import {
	type BackupExportResult,
	type BackupFile,
	type BackupPickResult,
	MAX_BACKUP_BYTES,
	backupFileName,
	backupSummary,
	buildBackup,
	isUnsafePath,
	parseBackup,
} from "../shared/backup";
import { coerceNotesFile, mergeNotesFiles } from "../shared/notes";
import { coerceReadingStats, mergeReadingStats } from "../shared/readingStats";
import { MAX_RECENT_BOOKS } from "../shared/recentBooks";
import {
	appConfigInfo,
	backupSettings,
	dataDir,
	restoreBackupSettings,
} from "./appConfigStore";
import { writeFileAtomic } from "./atomicFile";
import { assertDocumentSize } from "./fileSizeLimit";
import { applyGlobalShortcuts } from "./globalShortcuts";
import { syncTray } from "./tray";
import { pushWatchedFiles } from "./watchedFolders";

/**
 * Other JSON files in the data folder that a backup carries under
 * `extra[key]`. `coerce` validates what comes back from a backup file before
 * it is written. Replace takes the backup's file; merge combines it with the
 * one here using `merge`. The renderer saves what it holds before either and
 * reloads these files afterwards (see backupRestore.ts).
 */
type ExtraBackupFile<T> = {
	key: string;
	file: string;
	coerce: (raw: unknown) => T;
	merge: (current: T, incoming: T) => T;
};
const extraFile = <T>(f: ExtraBackupFile<T>): ExtraBackupFile<unknown> =>
	f as ExtraBackupFile<unknown>;

export const EXTRA_BACKUP_FILES = [
	extraFile({
		key: "notes",
		file: "notes.json",
		coerce: coerceNotesFile,
		merge: mergeNotesFiles,
	}),
	extraFile({
		key: "stats",
		file: "reading-stats.json",
		coerce: coerceReadingStats,
		merge: mergeReadingStats,
	}),
];

function readJsonFile(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// Not there (or unreadable).
		return undefined;
	}
}

const FILTERS = [{ name: "Cross TTS backup", extensions: ["json"] }];

/** The backup the user picked, kept until they choose merge or replace. */
let picked: BackupFile | null = null;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function readExtraFiles(): Record<string, unknown> {
	const extra: Record<string, unknown> = {};
	for (const { key, file } of EXTRA_BACKUP_FILES) {
		const data = readJsonFile(join(dataDir(), file));
		if (data !== undefined) extra[key] = data;
	}
	return extra;
}

/**
 * Paths that aren't files this computer can reach. Network paths count as
 * missing without being looked at: checking one would connect to its host.
 */
async function missingPaths(paths: unknown): Promise<string[]> {
	if (!Array.isArray(paths)) return [];
	const list = paths
		.filter((p): p is string => typeof p === "string")
		.slice(0, MAX_RECENT_BOOKS);
	const gone = await Promise.all(
		list.map((p) =>
			isAbsolute(p) && !isUnsafePath(p)
				? access(p).then(
						() => false,
						() => true,
					)
				: true,
		),
	);
	return list.filter((_, i) => gone[i]);
}

async function exportBackup(
	parent: BrowserWindow | null,
	library: unknown,
): Promise<BackupExportResult | null> {
	const now = new Date();
	const options = {
		title: "Save backup",
		defaultPath: backupFileName(now),
		filters: FILTERS,
	};
	const result = parent
		? await dialog.showSaveDialog(parent, options)
		: await dialog.showSaveDialog(options);
	if (result.canceled || !result.filePath) return null;
	try {
		const data = buildBackup({
			library,
			settings: backupSettings(),
			extra: readExtraFiles(),
			appVersion: app.getVersion(),
			now,
		});
		writeFileAtomic(result.filePath, JSON.stringify(data, null, "\t"));
		return { filePath: result.filePath, summary: backupSummary(data) };
	} catch (e) {
		return { error: errorText(e) };
	}
}

async function pickBackup(
	parent: BrowserWindow | null,
): Promise<BackupPickResult | null> {
	const options = {
		title: "Choose a backup to restore",
		properties: ["openFile" as const],
		filters: FILTERS,
	};
	const result = parent
		? await dialog.showOpenDialog(parent, options)
		: await dialog.showOpenDialog(options);
	const filePath = result.filePaths[0];
	if (result.canceled || !filePath) return null;
	try {
		const info = await stat(filePath);
		if (!info.isFile()) return { error: "That isn't a file." };
		// Checked before anything is read into memory.
		assertDocumentSize(filePath, info.size, MAX_BACKUP_BYTES);
		const parsed = parseBackup(await readFile(filePath, "utf8"));
		if (!parsed.ok) return { error: parsed.error };
		// Only now: a pick that fails leaves the earlier one (which the window
		// still shows) in place.
		picked = parsed.data;
		const { books, bookmarks, rules } = parsed.data;
		return {
			fileName: basename(filePath),
			library: { books, bookmarks, rules },
			summary: backupSummary(parsed.data),
			missingPaths: await missingPaths(Object.keys(books)),
		};
	} catch (e) {
		return { error: errorText(e) };
	}
}

/**
 * The main-process half of a restore (the renderer restores books, bookmarks
 * and rules into its own stores). Replace takes the backup's settings; merge
 * keeps this computer's and only adds the backup's watched folders.
 */
function applyPickedSettings(mode: unknown): void {
	const data = picked;
	picked = null;
	if (!data) return;
	const replace = mode === "replace";
	if (data.settings) {
		const current = backupSettings();
		restoreBackupSettings(
			replace
				? data.settings
				: {
						...current,
						watchedFolders: [
							...new Set([
								...current.watchedFolders,
								...data.settings.watchedFolders,
							]),
						],
					},
		);
	}
	for (const { key, file, coerce, merge } of EXTRA_BACKUP_FILES) {
		if (!(key in data.extra)) continue;
		const path = join(dataDir(), file);
		const incoming = coerce(data.extra[key]);
		const current = replace ? undefined : readJsonFile(path);
		writeFileAtomic(
			path,
			JSON.stringify(
				current === undefined ? incoming : merge(coerce(current), incoming),
			),
		);
	}
	applyGlobalShortcuts();
	syncTray();
	pushWatchedFiles();
}

export function registerBackupHandlers(window: () => BrowserWindow | null): void {
	ipcMain.handle(
		"backupExport",
		(_event, params: { library?: unknown } | undefined) =>
			exportBackup(window(), params?.library),
	);
	ipcMain.handle("backupPick", () => pickBackup(window()));
	ipcMain.handle(
		"backupApplySettings",
		(_event, params: { mode?: unknown } | undefined) => {
			applyPickedSettings(params?.mode);
			return appConfigInfo();
		},
	);
	ipcMain.handle(
		"missingPaths",
		(_event, params: { paths?: unknown } | undefined) =>
			missingPaths(params?.paths),
	);
}
