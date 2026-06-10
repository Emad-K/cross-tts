import {
	selectNewWatchedPaths,
	type WatchedFileCandidate,
} from "@shared/watchedFolders";
import { showToast } from "@/components/toast/toastStore";
import {
	getWatchedFileCandidates,
	subscribeToWatchedFiles,
} from "@/lib/desktopBridge";
import { addBookToLibrary, touchSessionSave } from "../sessionPersistence";
import { useLibraryStore } from "./libraryStore";

/**
 * Paths already handled this session. The main process pushes the *full*
 * found-file list on every scan, so without this a book the user removed from
 * the library (or an unreadable file) would be re-added / re-tried every 60 s.
 */
const seen = new Set<string>();

async function handleCandidates(
	candidates: WatchedFileCandidate[],
): Promise<void> {
	const libraryPaths = new Set(Object.keys(useLibraryStore.getState().books));
	const fresh = selectNewWatchedPaths(candidates, libraryPaths, seen);
	if (fresh.length === 0) return;
	// Mark before the (async) adds so an overlapping snapshot can't double-add.
	for (const path of fresh) seen.add(path);
	let added = 0;
	for (const path of fresh) {
		if ((await addBookToLibrary(path)) !== null) added++;
	}
	if (added > 0) {
		touchSessionSave();
		showToast({
			title: `Added ${added} new book${added === 1 ? "" : "s"} from watched folder`,
		});
	}
}

/**
 * Auto-add new .epub/.txt files from watched folders to the library. Call once
 * at app start: subscribes to main-process scan snapshots and pulls an initial
 * one (covering files that appeared while the app was closed). Returns an
 * unsubscribe fn. No-op on web.
 */
export function initWatchedFoldersSync(): () => void {
	// Subscribe first so no snapshot can slip between the pull and the listener.
	const unsubscribe = subscribeToWatchedFiles((candidates) => {
		void handleCandidates(candidates);
	});
	void getWatchedFileCandidates().then((candidates) => {
		if (candidates.length > 0) void handleCandidates(candidates);
	});
	return unsubscribe;
}
