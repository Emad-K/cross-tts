import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { documentKind } from "../../shared/droppedFiles";
import { htmlToChapters, type HtmlChapter } from "../../shared/htmlChapters";
import { markdownToHtml } from "../../shared/markdownToHtml";
import type { ReaderChapter } from "../../shared/readerTypes";
import {
	MAX_DOCX_BYTES,
	MAX_MARKUP_BYTES,
	assertDocumentSize,
} from "../fileSizeLimit";

/**
 * Word, HTML and Markdown files as chaptered books. Each file is converted to
 * one HTML document, sanitized, and split at its h1/h2 headings; the result
 * has the same shape the EPUB reader serves (see `ReadEpubDocumentResult`).
 *
 * Runs in the main process like EPUB parsing. Nothing here executes document
 * content or follows a reference out of the file.
 */

export type ChapteredKind = "docx" | "html" | "md";

export type ChapteredBook = {
	source: ChapteredKind;
	title: string;
	chapters: ReaderChapter[];
	content: Map<string, { html: string; text: string }>;
};

export function chapteredKind(filePath: string): ChapteredKind | null {
	const kind = documentKind(filePath);
	return kind === "docx" || kind === "html" || kind === "md" ? kind : null;
}

/** File name without its extension: the title when the file names none. */
export function titleFromFileName(filePath: string): string {
	return basename(filePath, extname(filePath)) || basename(filePath);
}

/** Decode HTML bytes, honouring a BOM or `<meta charset>`; UTF-8 otherwise. */
function decodeHtml(bytes: Uint8Array): string {
	const head = Buffer.from(bytes.subarray(0, 2048)).toString("latin1");
	const label = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1];
	try {
		return new TextDecoder(label ?? "utf-8").decode(bytes);
	} catch {
		return new TextDecoder("utf-8").decode(bytes); // unknown charset label
	}
}

async function docxToHtml(bytes: Uint8Array): Promise<string> {
	// Loaded on first use: most sessions never open a Word file.
	const mammoth = (await import("mammoth")).default;
	const { value } = await mammoth.convertToHtml(
		{ buffer: Buffer.from(bytes) },
		{
			// Default, stated: never read files a document links to.
			externalFileAccess: false,
			// Images aren't read aloud; don't inflate them into data: URLs.
			convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
		},
	);
	return value;
}

/** Convert a document's bytes to chapters. Exported for the fixture tests. */
export async function convertToChapters(
	kind: ChapteredKind,
	bytes: Uint8Array,
	fileTitle: string,
): Promise<{ title: string; chapters: HtmlChapter[] }> {
	let html: string;
	let title = fileTitle;
	if (kind === "docx") {
		html = await docxToHtml(bytes);
	} else if (kind === "md") {
		html = markdownToHtml(new TextDecoder("utf-8").decode(bytes));
	} else {
		html = decodeHtml(bytes);
		// Head of the file only, with bounded runs: an unanchored scan of a
		// crafted file is quadratic.
		const named = /<title\b[^<>]{0,200}>([^<]{0,1000})<\/title\s*>/i.exec(
			html.slice(0, 65536),
		)?.[1];
		title = named?.replace(/\s+/g, " ").trim().slice(0, 200) || fileTitle;
	}
	return { title, chapters: htmlToChapters(html, title) };
}

/** Converted books, most recently used last. Keyed like `epubCache`. */
const cache = new Map<string, ChapteredBook>();
const CACHE_MAX = 4;

export async function loadChapteredBook(filePath: string): Promise<ChapteredBook | null> {
	const kind = chapteredKind(filePath);
	if (!kind) return null;
	let key: string;
	try {
		const st = statSync(filePath);
		if (!st.isFile()) return null;
		// ponytail: for .docx this is the zipped size; one crafted entry can
		// still inflate large (same ceiling as EPUB).
		assertDocumentSize(filePath, st.size, kind === "docx" ? MAX_DOCX_BYTES : MAX_MARKUP_BYTES);
		key = `${filePath}:${st.mtimeMs}:${st.size}`;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code) return null; // stat failed
		throw err;
	}
	const cached = cache.get(key);
	if (cached) {
		cache.delete(key);
		cache.set(key, cached);
		return cached;
	}

	let bytes: Uint8Array;
	try {
		bytes = await readFile(filePath);
	} catch {
		return null;
	}
	const { title, chapters } = await convertToChapters(kind, bytes, titleFromFileName(filePath));
	if (chapters.length === 0) {
		throw new Error(`"${basename(filePath)}" has no text to read.`);
	}
	const book: ChapteredBook = {
		source: kind,
		title,
		chapters: chapters.map(({ id, title, level }) => ({ id, title, level })),
		content: new Map(chapters.map((c) => [c.id, { html: c.html, text: c.text }])),
	};
	for (const stale of cache.keys()) {
		if (stale.startsWith(`${filePath}:`)) cache.delete(stale);
	}
	cache.set(key, book);
	while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
	return book;
}
