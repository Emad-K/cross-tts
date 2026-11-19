import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
	EpubChapterContentResult,
	ReadEpubDocumentResult,
} from "@shared/documentRpc";
import { pdfChapterRanges, type PdfChapterRange } from "@shared/pdfText";
import {
	PDF_NO_TEXT_MESSAGE,
	pdfChapterContent,
	pdfHasText,
	pdfOutlineEntries,
} from "./pdfExtract";

/**
 * PDF books. Parsing runs here, in the sandboxed renderer, inside pdf.js's own
 * Web Worker: no Node, no `window.api`, and bound by the app's CSP, so a
 * hostile PDF gets the least it can. The main process only hands over bytes.
 *
 * The worker is a bundled chunk served from app:// (CSP `worker-src 'self'`);
 * pdf.js is loaded on first use, so it costs nothing until a PDF is opened.
 *
 * Limitation: pdf.js's CMap files are not bundled, so PDFs that rely on the
 * predefined CJK CMaps extract as garbled text. Bundling `pdfjs-dist/cmaps`
 * (about 1.6 MB) and passing `cMapUrl` fixes that.
 */

type OpenPdf = {
	doc: PDFDocumentProxy;
	ranges: PdfChapterRange[];
	content: Map<string, Promise<{ html: string; text: string }>>;
};

/**
 * Parsed PDFs by path, most recently used last.
 * ponytail: evicting a PDF destroys it, which fails a chapter read still in
 * flight on it. Only reachable by opening two other PDFs mid-read; count
 * readers before destroying if that ever shows up.
 */
const openPdfs = new Map<string, Promise<OpenPdf>>();
const MAX_OPEN_PDFS = 2;

let pdfjs: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
	pdfjs ??= Promise.all([
		import("pdfjs-dist/build/pdf.min.mjs"),
		import("pdfjs-dist/build/pdf.worker.min.mjs?worker"),
	]).then(([lib, worker]) => {
		lib.GlobalWorkerOptions.workerPort = new worker.default();
		return lib;
	});
	return pdfjs;
}

async function parse(filePath: string): Promise<OpenPdf> {
	const data = await window.api?.request.readDocumentBytes({ filePath });
	if (!data) throw new Error("The PDF file wasn't found.");
	const lib = await loadPdfjs();
	let doc: PDFDocumentProxy;
	try {
		doc = await lib.getDocument({
			data,
			// Text only: no font loading, no wasm decoders, no fetches, no forms.
			disableFontFace: true,
			useSystemFonts: false,
			useWasm: false,
			useWorkerFetch: false,
			enableXfa: false,
			verbosity: lib.VerbosityLevel.ERRORS,
		}).promise;
	} catch (err) {
		throw new Error(
			(err as { name?: string }).name === "PasswordException"
				? "This PDF is password-protected, so Cross TTS can't open it."
				: "This PDF couldn't be read. The file may be damaged.",
		);
	}
	if (!(await pdfHasText(doc))) {
		void doc.loadingTask.destroy();
		throw new Error(PDF_NO_TEXT_MESSAGE);
	}
	const ranges = pdfChapterRanges(await pdfOutlineEntries(doc), doc.numPages);
	return { doc, ranges, content: new Map() };
}

function destroy(entry: Promise<OpenPdf>): void {
	void entry.then((pdf) => pdf.doc.loadingTask.destroy()).catch(() => {});
}

function remember(filePath: string, entry: Promise<OpenPdf>): void {
	openPdfs.delete(filePath);
	openPdfs.set(filePath, entry);
	for (const [path, old] of openPdfs) {
		if (openPdfs.size <= MAX_OPEN_PDFS) break;
		openPdfs.delete(path);
		destroy(old);
	}
	// A failed parse must not be served again from the cache.
	entry.catch(() => {
		if (openPdfs.get(filePath) === entry) openPdfs.delete(filePath);
	});
}

/**
 * Open a PDF: `placeholder` is what the main process returned for the path
 * (name and title, no chapters). Always re-reads the file, so an edited PDF is
 * never served stale. Throws a readable error for scanned, locked or damaged
 * files.
 */
export async function openPdf(
	placeholder: ReadEpubDocumentResult,
): Promise<ReadEpubDocumentResult> {
	const { filePath } = placeholder;
	const previous = openPdfs.get(filePath);
	if (previous) destroy(previous);
	const entry = parse(filePath);
	remember(filePath, entry);
	const { ranges } = await entry;
	return {
		...placeholder,
		chapters: ranges.map(({ id, title }) => ({ id, title, level: 0 })),
	};
}

/** One chapter of a PDF, in the shape `getEpubChapterContent` returns. */
export async function pdfChapter(
	filePath: string,
	chapterId: string,
): Promise<EpubChapterContentResult | null> {
	const entry = openPdfs.get(filePath) ?? parse(filePath);
	remember(filePath, entry);
	const pdf = await entry;
	const range = pdf.ranges.find((r) => r.id === chapterId);
	if (!range) return null;
	let content = pdf.content.get(chapterId);
	if (!content) {
		content = pdfChapterContent(pdf.doc, range);
		pdf.content.set(chapterId, content);
		content.catch(() => pdf.content.delete(chapterId));
	}
	return { chapterId, ...(await content) };
}
