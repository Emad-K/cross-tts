/** A saved spot in a book: a chapter + chunk the reader can jump back to. */
export type Bookmark = {
	/** Stable id derived from the position (`<chapterId>#<chunkIndex>`). */
	id: string;
	/** EPUB chapter id, or null for .txt. */
	chapterId: string | null;
	chunkIndex: number;
	/** Short human label (chapter title + a text snippet). */
	label: string;
	createdAt: number;
};

export function bookmarkId(chapterId: string | null, chunkIndex: number): string {
	return `${chapterId ?? ""}#${chunkIndex}`;
}

/** Toggle a bookmark at a position: remove it if present, else add it. */
export function toggleBookmark(
	list: Bookmark[],
	entry: Bookmark,
): Bookmark[] {
	if (list.some((b) => b.id === entry.id)) {
		return list.filter((b) => b.id !== entry.id);
	}
	return [...list, entry];
}

export function hasBookmark(
	list: Bookmark[],
	chapterId: string | null,
	chunkIndex: number,
): boolean {
	const id = bookmarkId(chapterId, chunkIndex);
	return list.some((b) => b.id === id);
}

/** Bookmarks ordered for display: by chunk position (chapter order isn't known here). */
export function sortBookmarks(list: Bookmark[]): Bookmark[] {
	return [...list].sort((a, b) => a.chunkIndex - b.chunkIndex || a.createdAt - b.createdAt);
}

function coerceBookmark(raw: unknown): Bookmark | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	const chunkIndex =
		typeof o.chunkIndex === "number" && o.chunkIndex >= 0
			? Math.floor(o.chunkIndex)
			: null;
	if (chunkIndex === null) return null;
	const chapterId =
		typeof o.chapterId === "string" && o.chapterId.length > 0
			? o.chapterId
			: null;
	return {
		id:
			typeof o.id === "string" && o.id.length > 0
				? o.id
				: bookmarkId(chapterId, chunkIndex),
		chapterId,
		chunkIndex,
		label: typeof o.label === "string" ? o.label : `Chunk ${chunkIndex + 1}`,
		createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
	};
}

/** Validate a persisted `path -> Bookmark[]` map, dropping malformed entries. */
export function coerceBookmarksByPath(
	raw: unknown,
): Record<string, Bookmark[]> {
	if (!raw || typeof raw !== "object") return {};
	const out: Record<string, Bookmark[]> = {};
	for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!path || !Array.isArray(value)) continue;
		const seen = new Set<string>();
		const list: Bookmark[] = [];
		for (const item of value) {
			const bm = coerceBookmark(item);
			if (bm && !seen.has(bm.id)) {
				seen.add(bm.id);
				list.push(bm);
			}
		}
		if (list.length > 0) out[path] = list;
	}
	return out;
}
