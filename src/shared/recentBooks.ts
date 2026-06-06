/** One entry in the recent-books library: where to resume a previously-opened book. */
export type BookProgress = {
	/** Absolute file path; the map key. */
	path: string;
	/** Display title (EPUB title or filename). */
	title: string;
	format: "txt" | "epub";
	/** Active EPUB chapter id, or null for .txt. */
	chapterId: string | null;
	chunkIndex: number;
	/** Epoch ms of the last update; used for ordering and pruning. */
	updatedAt: number;
};

export const MAX_RECENT_BOOKS = 24;

/**
 * Insert/replace a book's progress, then keep only the `max` most-recently
 * updated entries. Pure — callers pass `updatedAt` so this stays deterministic.
 */
export function upsertRecentBook(
	books: Record<string, BookProgress>,
	entry: BookProgress,
	max: number = MAX_RECENT_BOOKS,
): Record<string, BookProgress> {
	const next: Record<string, BookProgress> = { ...books, [entry.path]: entry };
	const paths = Object.keys(next);
	if (paths.length <= max) return next;
	const keep = paths
		.sort((a, b) => next[b]!.updatedAt - next[a]!.updatedAt)
		.slice(0, max);
	const pruned: Record<string, BookProgress> = {};
	for (const p of keep) pruned[p] = next[p]!;
	return pruned;
}

/** Books as a list, most-recently-updated first. */
export function recentBooksList(
	books: Record<string, BookProgress>,
): BookProgress[] {
	return Object.values(books).sort((a, b) => b.updatedAt - a.updatedAt);
}

function coerceBookProgress(raw: unknown): BookProgress | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (typeof o.path !== "string" || o.path.length === 0) return null;
	const format = o.format === "epub" ? "epub" : "txt";
	return {
		path: o.path,
		title:
			typeof o.title === "string" && o.title.length > 0 ? o.title : o.path,
		format,
		chapterId:
			typeof o.chapterId === "string" && o.chapterId.length > 0
				? o.chapterId
				: null,
		chunkIndex:
			typeof o.chunkIndex === "number" && o.chunkIndex >= 0
				? Math.floor(o.chunkIndex)
				: 0,
		updatedAt:
			typeof o.updatedAt === "number" && o.updatedAt >= 0 ? o.updatedAt : 0,
	};
}

/** Validate a persisted books map, dropping malformed entries and capping size. */
export function coerceRecentBooks(
	raw: unknown,
): Record<string, BookProgress> {
	if (!raw || typeof raw !== "object") return {};
	const out: Record<string, BookProgress> = {};
	for (const value of Object.values(raw as Record<string, unknown>)) {
		const entry = coerceBookProgress(value);
		if (entry) out[entry.path] = entry;
	}
	// Cap defensively in case the file was hand-edited.
	const list = recentBooksList(out).slice(0, MAX_RECENT_BOOKS);
	const capped: Record<string, BookProgress> = {};
	for (const e of list) capped[e.path] = e;
	return capped;
}
