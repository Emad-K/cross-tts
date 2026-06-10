import { isSupportedDocumentName } from "./droppedFiles";

/**
 * A document file found inside a watched folder, pushed from the main process
 * via the `app:watched-files` event (full snapshot each scan; the renderer
 * dedupes against its library + an in-session seen-set).
 */
export type WatchedFileCandidate = { path: string };

/**
 * Pick the candidate paths that should be added to the library: supported
 * document files (.epub/.txt) that are neither already in the library nor
 * already handled this session. Dedupes within the snapshot and preserves
 * the scan order.
 */
export function selectNewWatchedPaths(
	candidates: readonly WatchedFileCandidate[],
	libraryPaths: ReadonlySet<string>,
	seenPaths: ReadonlySet<string>,
): string[] {
	const out: string[] = [];
	const taken = new Set<string>();
	for (const { path } of candidates) {
		if (!path || taken.has(path)) continue;
		if (!isSupportedDocumentName(path)) continue;
		if (libraryPaths.has(path) || seenPaths.has(path)) continue;
		taken.add(path);
		out.push(path);
	}
	return out;
}

/**
 * Coerce a persisted watched-folder list: strings only, trimmed, non-empty,
 * deduped, order preserved. (Absoluteness is checked by the main process,
 * which has access to node:path.)
 */
export function coerceWatchedFolders(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const taken = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const dir = entry.trim();
		if (!dir || taken.has(dir)) continue;
		taken.add(dir);
		out.push(dir);
	}
	return out;
}
