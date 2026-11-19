import { useEffect } from "react";
import { loadNotes } from "../notes/notesStore";
import { loadStats, startStatsTracker } from "../stats/statsStore";
import { useTtsRulesStore } from "../ttsRules/ttsRulesStore";
import type { LoadedDocument } from "../types";
import { openBookFromDocument, useOpenBookStore } from "./openBookStore";

/**
 * Keeps the per-book extras in step with the open document: which book's
 * pronunciation rules apply, whose notes are shown, and the listening counters.
 * Renders nothing.
 */
export function BookDataSync({ document }: { document: LoadedDocument | null }) {
	// Child effects run before the reader's own, so the book's rules are in
	// place before its text is chunked and spoken.
	useEffect(() => {
		const book = openBookFromDocument(document);
		useOpenBookStore.setState({ book });
		useTtsRulesStore.getState().setCurrentBook(book?.path ?? null);
	}, [document]);

	useEffect(() => {
		void loadNotes();
		void loadStats();
		return startStatsTracker();
	}, []);

	return null;
}
