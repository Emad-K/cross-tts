import { create } from "zustand";
import type { Bookmark } from "@shared/bookmarks";
import { bookmarkId, toggleBookmark } from "@shared/bookmarks";
import { useTtsStore } from "../tts";

type BookmarksStore = {
	/** Saved spots keyed by document path (mirrors the persisted session map). */
	byPath: Record<string, Bookmark[]>;
	/** Current reading location, so the toggle button knows what to bookmark. */
	currentPath: string | null;
	currentChapterId: string | null;
	setAll: (byPath: Record<string, Bookmark[]>) => void;
	setLocation: (path: string | null, chapterId: string | null) => void;
	/** Add/remove a bookmark at the given position for the current book. */
	toggleAt: (entry: Bookmark) => void;
};

export const useBookmarksStore = create<BookmarksStore>((set, get) => ({
	byPath: {},
	currentPath: null,
	currentChapterId: null,
	setAll: (byPath) => set({ byPath }),
	setLocation: (currentPath, currentChapterId) =>
		set({ currentPath, currentChapterId }),
	toggleAt: (entry) => {
		const { currentPath, byPath } = get();
		if (!currentPath) return;
		const next = toggleBookmark(byPath[currentPath] ?? [], entry);
		const copy = { ...byPath };
		if (next.length > 0) copy[currentPath] = next;
		else delete copy[currentPath];
		set({ byPath: copy });
	},
}));

/** Non-reactive read of one book's bookmarks. */
export function getBookmarksFor(path: string | null): Bookmark[] {
	if (!path) return [];
	return useBookmarksStore.getState().byPath[path] ?? [];
}

/** Toggle a bookmark at the current reading position (current book + chunk). */
export function bookmarkCurrentSpot(): void {
	const s = useBookmarksStore.getState();
	if (!s.currentPath) return;
	const t = useTtsStore.getState();
	if (t.chunks.length === 0) return;
	const chunkIndex = t.currentChunkIndex;
	const label =
		(t.chunks[chunkIndex]?.text ?? "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 60) || `Chunk ${chunkIndex + 1}`;
	s.toggleAt({
		id: bookmarkId(s.currentChapterId, chunkIndex),
		chapterId: s.currentChapterId,
		chunkIndex,
		label,
		createdAt: Date.now(),
	});
}

// --- jump handler: ReaderApp owns chapter/chunk navigation, registers here ---
type NavHandler = (bm: Bookmark) => void;
let navHandler: NavHandler | null = null;

export function setBookmarkNavHandler(handler: NavHandler | null): void {
	navHandler = handler;
}

export function navigateToBookmark(bm: Bookmark): void {
	navHandler?.(bm);
}
