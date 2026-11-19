import type { ReaderChapter } from "@shared/readerTypes";

export type { ReaderChapter };

/**
 * Supported document kinds.
 */
export type DocumentFormat = "txt" | "epub";

/**
 * Normalized document loaded into the reader. One variant per {@link DocumentFormat}.
 */
export type LoadedDocument =
	| {
			format: "txt";
			fileName: string;
			filePath?: string;
			/** Clipboard text opened with "Paste text"; unsaved while it has no path. */
			pasted?: boolean;
			text: string;
			chapters?: ReaderChapter[];
	  }
	| {
			format: "epub";
			fileName: string;
			filePath: string;
			title: string;
			chapters: ReaderChapter[];
	  };
