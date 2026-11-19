import { create } from "zustand";
import type { LoadedDocument, ReaderChapter } from "../types";

/** What notes, per-book rules and stats need to know about the open document. */
export type OpenBook = {
	/** Null for unsaved text (the sample): nothing is stored per book then. */
	path: string | null;
	title: string;
	format: LoadedDocument["format"];
	/** EPUB chapters in reading order; empty for plain text. */
	chapters: ReaderChapter[];
};

export const useOpenBookStore = create<{ book: OpenBook | null }>(() => ({
	book: null,
}));

export function openBookFromDocument(doc: LoadedDocument | null): OpenBook | null {
	if (!doc) return null;
	return {
		path: doc.filePath ?? null,
		title: doc.format === "epub" ? doc.title : doc.fileName,
		format: doc.format,
		chapters: doc.format === "epub" ? doc.chapters : [],
	};
}
