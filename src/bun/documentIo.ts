import { basename } from "node:path";
import { type BrowserWindow, dialog } from "electron";
import type {
	EpubChapterContentResult,
	ReadDocumentResult,
} from "../shared/documentRpc";
import {
	readEpubChapterContent,
	readEpubCover,
	readEpubManifest,
} from "./epub/parseEpub";
import { readTextDocumentAtPath } from "./textDocumentIo";

/** Cover image (data URL) for an EPUB path, or null for non-EPUB / no cover. */
export async function getBookCover(filePath: string): Promise<string | null> {
	if (!isEpubPath(filePath)) return null;
	return readEpubCover(filePath);
}

function isEpubPath(path: string): boolean {
	return path.toLowerCase().endsWith(".epub");
}

function pathsFromOpenDialogResult(paths: string[]): string[] {
	return paths.map((p) => p.trim()).filter((p) => p.length > 0);
}

const DOCUMENT_FILE_FILTERS = [
	{ name: "Documents", extensions: ["txt", "epub"] },
	{ name: "All Files", extensions: ["*"] },
];

export async function readDocumentAtPath(
	filePath: string,
): Promise<ReadDocumentResult | null> {
	if (isEpubPath(filePath)) {
		const manifest = await readEpubManifest(filePath);
		if (!manifest) return null;
		return {
			format: "epub",
			filePath,
			fileName: basename(filePath),
			title: manifest.title,
			chapters: manifest.chapters,
		};
	}
	const txt = readTextDocumentAtPath(filePath);
	if (!txt) return null;
	return txt;
}

export async function pickDocument(
	parent: BrowserWindow | null,
): Promise<ReadDocumentResult | null> {
	const result = parent
		? await dialog.showOpenDialog(parent, {
				properties: ["openFile"],
				filters: DOCUMENT_FILE_FILTERS,
			})
		: await dialog.showOpenDialog({
				properties: ["openFile"],
				filters: DOCUMENT_FILE_FILTERS,
			});
	if (result.canceled) return null;
	const filePath = pathsFromOpenDialogResult(result.filePaths)[0];
	if (!filePath) return null;
	return readDocumentAtPath(filePath);
}

export async function getEpubChapterContent(
	filePath: string,
	chapterId: string,
): Promise<EpubChapterContentResult | null> {
	const content = await readEpubChapterContent(filePath, chapterId);
	if (!content) return null;
	return { chapterId, html: content.html, text: content.text };
}
