/** Document file extensions the app can read (lowercase, no dot). */
export const SUPPORTED_DOCUMENT_EXTENSIONS = [
	"epub",
	"pdf",
	"docx",
	"txt",
	"md",
	"markdown",
	"html",
	"htm",
] as const;

/** For messages: the formats a person can open. */
export const SUPPORTED_DOCUMENT_LABEL =
	"EPUB, PDF, Word (.docx), text, Markdown and HTML files";

/**
 * How a file is read, from its extension: null when unsupported.
 * `.htm` and `.markdown` fold into "html" and "md".
 */
export type DocumentKind = "txt" | "epub" | "pdf" | "docx" | "html" | "md";

export function documentKind(name: string): DocumentKind | null {
	const dot = name.lastIndexOf(".");
	const ext = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
	if (ext === "htm") return "html";
	if (ext === "markdown") return "md";
	return (SUPPORTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)
		? (ext as DocumentKind)
		: null;
}

/** True when a file name has a document extension the app can read. */
export function isSupportedDocumentName(name: string): boolean {
	return documentKind(name) !== null;
}

/** Split dropped files into supported documents and rejects. */
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
