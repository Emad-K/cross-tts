/**
 * Supported document kinds. Extend this union when adding EPUB, PDF, etc.
 */
export type DocumentFormat = "txt";

/** Table-of-contents entry; EPUB spine items will map here later. */
export type ReaderChapter = {
	id: string;
	title: string;
	/** Nesting depth for EPUB nav (0 = top-level). */
	level?: number;
};

/**
 * Normalized document loaded into the reader. One variant per {@link DocumentFormat}.
 */
export type LoadedDocument =
	| {
			format: "txt";
			fileName: string;
			/** Absolute path when opened from disk; omitted for in-app samples */
			filePath?: string;
			/** Raw text for v1; later this may become a structured model */
			text: string;
			/** Explicit TOC; plain .txt may omit and derive sections in the UI. */
			chapters?: ReaderChapter[];
	  };
