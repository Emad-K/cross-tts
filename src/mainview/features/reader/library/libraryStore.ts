import { create } from "zustand";
import type { BookProgress } from "@shared/recentBooks";
import { recentBooksList } from "@shared/recentBooks";

type LibraryStore = {
	/** Recently-opened books keyed by path (mirrors the persisted session map). */
	books: Record<string, BookProgress>;
	setBooks: (books: Record<string, BookProgress>) => void;
	removeBook: (path: string) => void;
	/** Set user-curated metadata; empty values clear the field. */
	setBookDetails: (
		path: string,
		details: { series?: string; tags?: string[] },
	) => void;
};

export const useLibraryStore = create<LibraryStore>((set) => ({
	books: {},
	setBooks: (books) => set({ books }),
	removeBook: (path) =>
		set((s) => {
			if (!(path in s.books)) return s;
			const books = { ...s.books };
			delete books[path];
			return { books };
		}),
	setBookDetails: (path, details) =>
		set((s) => {
			const entry = s.books[path];
			if (!entry) return s;
			const series = details.series?.trim();
			const tags = details.tags?.map((t) => t.trim()).filter((t) => t.length > 0);
			// Write the entry directly (not via upsertRecentBook) so clearing a
			// field is not "rescued" by its merge-from-existing behavior.
			const next: BookProgress = {
				...entry,
				series: series ? series : undefined,
				tags: tags && tags.length > 0 ? tags : undefined,
			};
			return { books: { ...s.books, [path]: next } };
		}),
}));

/** Resume position (and per-book voice/speed) for a book, or null if unseen. */
export function getBookResume(path: string): {
	chapterId: string | null;
	chunkIndex: number;
	voice?: string;
	speed?: number;
} | null {
	const entry = useLibraryStore.getState().books[path];
	if (!entry) return null;
	return {
		chapterId: entry.chapterId,
		chunkIndex: entry.chunkIndex,
		voice: entry.voice,
		speed: entry.speed,
	};
}

/** Recent books, most-recent first (non-reactive read). */
export function getRecentBooks(): BookProgress[] {
	return recentBooksList(useLibraryStore.getState().books);
}
