import { basename } from "node:path";
import { Utils } from "electrobun/bun";
import type {
	EpubChapterContentResult,
	ReadDocumentResult,
} from "../shared/documentRpc";
import { readEpubChapterContent, readEpubManifest } from "./epub/parseEpub";
import { readTextDocumentAtPath } from "./textDocumentIo";

function isEpubPath(path: string): boolean {
	return path.toLowerCase().endsWith(".epub");
}

function pathsFromOpenDialogResult(paths: string[]): string[] {
	return paths.map((p) => p.trim()).filter((p) => p.length > 0);
}

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

export async function pickDocument(): Promise<ReadDocumentResult | null> {
	const chosen = await Utils.openFileDialog({
		allowedFileTypes: "*",
		canChooseFiles: true,
		canChooseDirectory: false,
		allowsMultipleSelection: false,
	});
	const filePath = pathsFromOpenDialogResult(chosen)[0];
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
