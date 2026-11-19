import {
	type BackupExportResult,
	type BackupLibrary,
	type BackupPickResult,
	type RestoreMode,
	mergeBackup,
} from "@shared/backup";
import { useBookmarksStore } from "../bookmarks/bookmarksStore";
import { checkMissingBooks } from "../library/missingBooks";
import { useLibraryStore } from "../library/libraryStore";
import { flushNotes, reloadNotes } from "../notes/notesStore";
import { flushStats, reloadStats } from "../stats/statsStore";
import { useAppSettingsStore } from "../settings/appSettingsStore";
import { useTtsRulesStore } from "../ttsRules/ttsRulesStore";

function currentLibrary(): BackupLibrary {
	const { regexRules, pronunciationRules } = useTtsRulesStore.getState();
	return {
		books: useLibraryStore.getState().books,
		bookmarks: useBookmarksStore.getState().byPath,
		rules: { regexRules, pronunciationRules },
	};
}

/**
 * Notes and listening stats are files the main process backs up and restores
 * itself, so what is still waiting to be saved has to be on disk first.
 */
function saveNotesAndStats(): void {
	flushNotes();
	flushStats();
}

/** Ask where to save and write a backup. Null if cancelled (or not the desktop app). */
export async function exportBackup(): Promise<BackupExportResult | null> {
	saveNotesAndStats();
	return (
		(await window.api?.request.backupExport({ library: currentLibrary() })) ?? null
	);
}

/** Ask for a backup file; the main process validates it. Null if cancelled. */
export async function pickBackup(): Promise<BackupPickResult | null> {
	return (await window.api?.request.backupPick()) ?? null;
}

/**
 * Put a picked backup into the app. Books, bookmarks and rules go into the
 * renderer's stores, and the normal session save writes them to disk: the
 * main process must not write the session file itself, because the next save
 * from here would overwrite it. Settings, notes and listening stats are
 * restored by the main process; the notes and stats stores then reload.
 * Returns how many custom text rules arrived switched off (see mergeBackup).
 */
export async function restoreBackup(
	library: BackupLibrary,
	mode: RestoreMode,
): Promise<number> {
	const merged = mergeBackup(currentLibrary(), library, mode);
	useLibraryStore.getState().setBooks(merged.books);
	useBookmarksStore.getState().setAll(merged.bookmarks);
	useTtsRulesStore.getState().hydrate(merged.rules);
	saveNotesAndStats();
	const config = await window.api?.request.backupApplySettings({ mode });
	if (config) useAppSettingsStore.getState().setConfig(config);
	await Promise.all([reloadNotes(), reloadStats()]);
	checkMissingBooks();
	return merged.rulesSwitchedOff;
}
