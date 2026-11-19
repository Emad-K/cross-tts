import type { ReaderChapter } from "./readerTypes";

export type ReadTextDocumentResult = {
	format: "txt";
	filePath: string;
	fileName: string;
	text: string;
};

/**
 * A book with chapters. ponytail: "epub" is a misnomer kept on purpose. PDF,
 * Word, HTML and Markdown books reuse this shape (and `getEpubChapterContent`)
 * so every `format === "epub"` check (chapters, sleep timer, audiobook export,
 * saved progress) covers them unchanged. Rename to "chaptered" if a format ever
 * needs to behave differently; `source` says what the file really is.
 */
export type ReadEpubDocumentResult = {
	format: "epub";
	/** Set for chaptered books that are not EPUBs. */
	source?: "pdf" | "docx" | "html" | "md";
	filePath: string;
	fileName: string;
	title: string;
	chapters: ReaderChapter[];
};

export type ReadDocumentResult = ReadTextDocumentResult | ReadEpubDocumentResult;

export type EpubChapterContentResult = {
	chapterId: string;
	html: string;
	text: string;
};
