import type { ReaderChapter } from "./readerTypes";

export type ReadTextDocumentResult = {
	format: "txt";
	filePath: string;
	fileName: string;
	text: string;
};

export type ReadEpubDocumentResult = {
	format: "epub";
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
