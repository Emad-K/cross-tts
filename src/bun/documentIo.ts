import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type BrowserWindow, dialog, nativeImage } from "electron";
import type {
	EpubChapterContentResult,
	ReadDocumentResult,
} from "../shared/documentRpc";
import { SUPPORTED_DOCUMENT_EXTENSIONS } from "../shared/droppedFiles";
import { dataDir } from "./appConfigStore";
import {
	readEpubChapterContent,
	readEpubCoverBytes,
	readEpubManifest,
} from "./epub/parseEpub";
import { MAX_PDF_BYTES, assertDocumentSize } from "./fileSizeLimit";
import {
	chapteredKind,
	loadChapteredBook,
	titleFromFileName,
} from "./formats/chapteredBook";
import { readTextDocumentAtPath } from "./textDocumentIo";

/** Cover thumbnail width; grid cards are small, so downscale aggressively. */
const COVER_THUMB_WIDTH = 256;

function coverCacheDir(): string {
	const dir = join(dataDir(), "covers");
	mkdirSync(dir, { recursive: true });
	return dir;
}

function jpegDataUrl(jpeg: Buffer): string {
	return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/**
 * Cover image (data URL) for an EPUB, downscaled to a thumbnail and cached on
 * disk. Returns null for non-EPUB or no cover. The cache key includes the file
 * mtime so a replaced book re-extracts. Falls back to the raw image if Electron
 * can't decode it (e.g. SVG/WebP covers).
 */
export async function getBookCover(filePath: string): Promise<string | null> {
	if (!isEpubPath(filePath)) return null;

	let mtimeMs = 0;
	try {
		mtimeMs = statSync(filePath).mtimeMs;
	} catch {
		return null;
	}

	const key = createHash("sha1").update(`${filePath}:${mtimeMs}`).digest("hex");
	const cachePath = join(coverCacheDir(), `${key}.jpg`);
	if (existsSync(cachePath)) {
		try {
			return jpegDataUrl(readFileSync(cachePath));
		} catch {
			// fall through and re-generate
		}
	}

	const raw = await readEpubCoverBytes(filePath);
	if (!raw) return null;

	try {
		let img = nativeImage.createFromBuffer(Buffer.from(raw.data));
		if (img.isEmpty()) {
			// Electron couldn't decode it (SVG/WebP): serve the original bytes.
			return `data:${raw.mime};base64,${Buffer.from(raw.data).toString("base64")}`;
		}
		if (img.getSize().width > COVER_THUMB_WIDTH) {
			img = img.resize({ width: COVER_THUMB_WIDTH, quality: "good" });
		}
		const jpeg = img.toJPEG(72);
		try {
			writeFileSync(cachePath, jpeg);
		} catch {
			// cache write is best-effort
		}
		return jpegDataUrl(jpeg);
	} catch {
		return `data:${raw.mime};base64,${Buffer.from(raw.data).toString("base64")}`;
	}
}

/**
 * Full-size raw cover bytes (no thumbnailing), for embedding into exported
 * audiobooks. Returns null for non-EPUBs or books without a cover.
 */
export async function getBookCoverBytes(
	filePath: string,
): Promise<{ data: Uint8Array; mime: string } | null> {
	if (!isEpubPath(filePath)) return null;
	return readEpubCoverBytes(filePath);
}

function isEpubPath(path: string): boolean {
	return path.toLowerCase().endsWith(".epub");
}

function pathsFromOpenDialogResult(paths: string[]): string[] {
	return paths.map((p) => p.trim()).filter((p) => p.length > 0);
}

const DOCUMENT_FILE_FILTERS = [
	{ name: "Documents", extensions: [...SUPPORTED_DOCUMENT_EXTENSIONS] },
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
	if (chapteredKind(filePath)) {
		const book = await loadChapteredBook(filePath);
		if (!book) return null;
		return {
			format: "epub",
			source: book.source,
			filePath,
			fileName: basename(filePath),
			title: book.title,
			chapters: book.chapters,
		};
	}
	if (isPdfPath(filePath)) return pdfPlaceholder(filePath);
	const txt = readTextDocumentAtPath(filePath);
	if (!txt) return null;
	return txt;
}

function isPdfPath(path: string): boolean {
	return path.toLowerCase().endsWith(".pdf");
}

/**
 * PDFs are parsed in the sandboxed renderer (pdf.js in a Web Worker), never
 * here. Main only confirms the file exists and is within the size cap, and
 * returns a book with no chapters yet; the renderer fills them in after
 * fetching the bytes with `readDocumentBytes` (see pdf/pdfDocument.ts).
 */
function pdfPlaceholder(filePath: string): ReadDocumentResult | null {
	let size: number;
	try {
		const st = statSync(filePath);
		if (!st.isFile()) return null;
		size = st.size;
	} catch {
		return null;
	}
	assertDocumentSize(filePath, size, MAX_PDF_BYTES);
	return {
		format: "epub",
		source: "pdf",
		filePath,
		fileName: basename(filePath),
		title: titleFromFileName(filePath),
		chapters: [],
	};
}

/**
 * Raw bytes of a PDF for the renderer's parser. Only regular `.pdf` files that
 * start like a PDF and fit the size cap: this must not become a way to read
 * arbitrary files.
 */
export function readPdfBytes(filePath: string): Uint8Array | null {
	if (typeof filePath !== "string" || !isPdfPath(filePath)) return null;
	if (!pdfPlaceholder(filePath)) return null;
	const bytes = readFileSync(filePath);
	// The header may sit a little way in; pdf.js looks in the first 1024 bytes.
	if (!bytes.subarray(0, 1024).includes("%PDF-")) {
		throw new Error(`"${basename(filePath)}" isn't a PDF file.`);
	}
	return bytes;
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
	const content = chapteredKind(filePath)
		? (await loadChapteredBook(filePath))?.content.get(chapterId)
		: await readEpubChapterContent(filePath, chapterId);
	if (!content) return null;
	return { chapterId, html: content.html, text: content.text };
}
