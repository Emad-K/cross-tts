import { create } from "zustand";
import { type Note, type NotesFile, coerceNotesFile } from "@shared/notes";
import { useBookmarksStore } from "../bookmarks/bookmarksStore";
import { useOpenBookStore } from "../bookData/openBookStore";
import { loadUserData, userDataSaver } from "../bookData/userData";

type NotesStore = {
	/** Highlights and notes keyed by book path (mirrors notes.json). */
	byPath: Record<string, Note[]>;
	/** Add a note, or replace the one with the same id. */
	upsert: (path: string, note: Note) => void;
	remove: (path: string, id: string) => void;
};

export const useNotesStore = create<NotesStore>((set) => {
	const setList = (path: string, edit: (list: Note[]) => Note[]) =>
		set((s) => {
			const byPath = { ...s.byPath };
			const next = edit(byPath[path] ?? []);
			if (next.length > 0) byPath[path] = next;
			else delete byPath[path];
			return { byPath };
		});
	return {
		byPath: {},
		upsert: (path, note) => {
			setList(path, (list) =>
				list.some((n) => n.id === note.id)
					? list.map((n) => (n.id === note.id ? note : n))
					: [...list, note],
			);
			saver.schedule();
		},
		remove: (path, id) => {
			setList(path, (list) => list.filter((n) => n.id !== id));
			saver.schedule();
		},
	};
});

const saver = userDataSaver(
	"notes",
	(): NotesFile => ({ version: 1, byPath: useNotesStore.getState().byPath }),
);

/** Load notes.json once at startup. Notes made before it arrives are kept. */
export async function loadNotes(): Promise<void> {
	const file = coerceNotesFile(await loadUserData("notes"));
	useNotesStore.setState((s) => ({ byPath: { ...file.byPath, ...s.byPath } }));
}

/**
 * Where a new note would be filed: the open book and, for EPUBs, its chapter
 * (plain text is one chapter, whatever heading the sidebar is on).
 */
export function useNoteLocation(): { path: string | null; chapterId: string | null } {
	const book = useOpenBookStore((s) => s.book);
	const chapterId = useBookmarksStore((s) => s.currentChapterId);
	return {
		path: book?.path ?? null,
		chapterId: book?.format === "epub" ? chapterId : null,
	};
}

export function getNoteLocation(): { path: string | null; chapterId: string | null } {
	const book = useOpenBookStore.getState().book;
	return {
		path: book?.path ?? null,
		chapterId:
			book?.format === "epub"
				? useBookmarksStore.getState().currentChapterId
				: null,
	};
}
