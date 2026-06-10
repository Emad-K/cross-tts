import type { BookProgress } from "@shared/recentBooks";

/** Library grid sort orders. "recent" relies on input being most-recent-first. */
export type LibrarySortKey = "recent" | "title" | "progress";

export const LIBRARY_SORT_LABELS: Record<LibrarySortKey, string> = {
	recent: "Recently read",
	title: "Title A–Z",
	progress: "Progress",
};

export function sortLibrary(
	list: BookProgress[],
	sort: LibrarySortKey,
): BookProgress[] {
	if (sort === "title") {
		return [...list].sort((a, b) => a.title.localeCompare(b.title));
	}
	if (sort === "progress") {
		return [...list].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
	}
	return list; // recentBooksList is already most-recent-first
}

/**
 * Text filter over title, series, and tags (case-insensitive substring),
 * optionally narrowed to books carrying `tag` (exact tag or series match).
 */
export function filterLibrary(
	list: BookProgress[],
	query: string,
	tag: string | null = null,
): BookProgress[] {
	const q = query.trim().toLowerCase();
	return list.filter((b) => {
		if (tag !== null && !(b.tags?.includes(tag) || b.series === tag)) {
			return false;
		}
		if (q.length === 0) return true;
		return (
			b.title.toLowerCase().includes(q) ||
			(b.series?.toLowerCase().includes(q) ?? false) ||
			(b.tags?.some((t) => t.toLowerCase().includes(q)) ?? false)
		);
	});
}

/** All distinct tag/series chips present in the library, sorted A–Z. */
export function collectLibraryTags(list: BookProgress[]): string[] {
	const tags = new Set<string>();
	for (const b of list) {
		if (b.series) tags.add(b.series);
		for (const t of b.tags ?? []) tags.add(t);
	}
	return [...tags].sort((a, b) => a.localeCompare(b));
}

/** Parse comma-separated tag input into trimmed, de-duplicated tags. */
export function parseTagsInput(raw: string): string[] {
	const out: string[] = [];
	for (const part of raw.split(",")) {
		const t = part.trim();
		if (t.length > 0 && !out.includes(t)) out.push(t);
	}
	return out;
}
