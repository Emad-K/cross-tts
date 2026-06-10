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
	/** Approximate read progress through the whole book, 0..1. */
	progress?: number;
	/** Per-book voice override (Kokoro voice id); falls back to the global voice. */
	voice?: string;
	/** Per-book playback speed; falls back to the global speed. */
	speed?: number;
	/** Epoch ms of the last update; used for ordering and pruning. */
	updatedAt: number;
	/** User-assigned series name (e.g. "Discworld"). */
	series?: string;
	/** User-assigned tags for filtering the library. */
	tags?: string[];
};

export const MAX_RECENT_BOOKS = 1000;

/**
 * Insert/replace a book's progress, then keep only the `max` most-recently
 * updated entries. Pure — callers pass `updatedAt` so this stays deterministic.
 *
 * User-curated metadata (`tags`/`series`) is preserved from the existing entry
 * when the incoming one omits it: progress saves rebuild entries from reader
 * state and must not wipe library edits.
 */
export function upsertRecentBook(
	books: Record<string, BookProgress>,
	entry: BookProgress,
	max: number = MAX_RECENT_BOOKS,
): Record<string, BookProgress> {
	const existing = books[entry.path];
	const merged: BookProgress = {
		...entry,
		series: entry.series ?? existing?.series,
		tags: entry.tags ?? existing?.tags,
	};
	const next: Record<string, BookProgress> = { ...books, [entry.path]: merged };
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
		progress:
			typeof o.progress === "number" && o.progress >= 0 && o.progress <= 1
				? o.progress
				: undefined,
		voice:
			typeof o.voice === "string" && o.voice.length > 0 ? o.voice : undefined,
		speed:
			typeof o.speed === "number" && o.speed >= 0.5 && o.speed <= 2
				? o.speed
				: undefined,
		updatedAt:
			typeof o.updatedAt === "number" && o.updatedAt >= 0 ? o.updatedAt : 0,
		series:
			typeof o.series === "string" && o.series.length > 0
				? o.series
				: undefined,
		tags: coerceTags(o.tags),
	};
}

/** Keep only non-empty string tags; missing/empty/malformed → undefined. */
function coerceTags(raw: unknown): string[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const tags = raw.filter(
		(t): t is string => typeof t === "string" && t.length > 0,
	);
	return tags.length > 0 ? tags : undefined;
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
