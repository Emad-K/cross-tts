import { basename } from "node:path";

/** Largest EPUB we load fully into memory (main process). */
export const MAX_EPUB_BYTES = 300 * 1024 * 1024;
/** Largest .txt we read as one string and send to the renderer. */
export const MAX_TXT_BYTES = 50 * 1024 * 1024;

/**
 * Throw a user-readable error when a document is over its cap, before anything
 * is read into memory. The message reaches the renderer through the IPC error.
 */
export function assertDocumentSize(
	filePath: string,
	size: number,
	limit: number,
): void {
	if (size <= limit) return;
	const mb = (n: number) => Math.round(n / (1024 * 1024));
	throw new Error(
		`"${basename(filePath)}" is too large to open (${mb(size)} MB; the limit is ${mb(limit)} MB).`,
	);
}
