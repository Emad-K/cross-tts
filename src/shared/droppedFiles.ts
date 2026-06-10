/** True when a file name has a document extension the app can read. */
export function isSupportedDocumentName(name: string): boolean {
	const lower = name.toLowerCase();
	return lower.endsWith(".txt") || lower.endsWith(".epub");
}

/** Split dropped files into supported documents (.txt/.epub) and rejects. */
export function partitionByDocumentSupport<T extends { name: string }>(
	files: readonly T[],
): { supported: T[]; rejected: T[] } {
	const supported: T[] = [];
	const rejected: T[] = [];
	for (const file of files) {
		(isSupportedDocumentName(file.name) ? supported : rejected).push(file);
	}
	return { supported, rejected };
}
