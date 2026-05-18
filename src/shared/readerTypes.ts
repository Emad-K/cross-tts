/** Table-of-contents entry shared between Bun and the webview. */
export type ReaderChapter = {
	id: string;
	title: string;
	/** Nesting depth for EPUB nav (0 = top-level). */
	level?: number;
};
