import { create } from "zustand";
import type { BookProgress } from "@shared/recentBooks";
import { recentBooksList } from "@shared/recentBooks";

type LibraryStore = {
	/** Recently-opened books keyed by path (mirrors the persisted session map). */
	books: Record<string, BookProgress>;
	setBooks: (books: Record<string, BookProgress>) => void;
	removeBook: (path: string) => void;
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
}));

/** Resume position for a previously-opened book, or null if unseen. */
export function getBookResume(
	path: string,
): { chapterId: string | null; chunkIndex: number } | null {
	const entry = useLibraryStore.getState().books[path];
	if (!entry) return null;
	return { chapterId: entry.chapterId, chunkIndex: entry.chunkIndex };
}

/** Recent books, most-recent first (non-reactive read). */
export function getRecentBooks(): BookProgress[] {
	return recentBooksList(useLibraryStore.getState().books);
}
