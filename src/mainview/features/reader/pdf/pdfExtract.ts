import type { PDFDocumentProxy } from "pdfjs-dist";
import { htmlToPlainText } from "@shared/htmlPlainText";
import {
	countLetters,
	joinPdfPages,
	paragraphsToHtml,
	pdfItemsToParagraphs,
	type PdfChapterRange,
	type PdfOutlineEntry,
	type PdfTextItem,
} from "@shared/pdfText";

/**
 * Text and chapter extraction from an open pdf.js document. No rendering:
 * pages are never drawn, so images, fonts and annotations are never decoded.
 * Kept apart from the worker setup so it can be tested under bun.
 */

export const PDF_NO_TEXT_MESSAGE =
	"This PDF has no selectable text. Scanned PDFs need OCR, which Cross TTS can't do yet.";

/** Letters needed before a PDF counts as having text (stray marks don't). */
const MIN_LETTERS = 20;

async function pageParagraphs(doc: PDFDocumentProxy, pageIndex: number): Promise<string[]> {
	const page = await doc.getPage(pageIndex + 1);
	try {
		const { items } = await page.getTextContent();
		return pdfItemsToParagraphs(
			items.filter((item): item is typeof item & PdfTextItem => "str" in item),
		);
	} finally {
		page.cleanup();
	}
}

/** Top-level outline (bookmark) entries with the page each one opens. */
export async function pdfOutlineEntries(doc: PDFDocumentProxy): Promise<PdfOutlineEntry[]> {
	const outline = await doc.getOutline().catch(() => null);
	const entries: PdfOutlineEntry[] = [];
	for (const node of outline ?? []) {
		try {
			const dest =
				typeof node.dest === "string" ? await doc.getDestination(node.dest) : node.dest;
			const target: unknown = dest?.[0];
			if (target == null) continue;
			const pageIndex =
				typeof target === "number"
					? target
					: await doc.getPageIndex(target as Parameters<typeof doc.getPageIndex>[0]);
			entries.push({ title: node.title, pageIndex });
		} catch {
			// A bookmark that points nowhere: skip it.
		}
	}
	return entries;
}

/** False for scanned (image-only) PDFs. Stops at the first page with real text. */
export async function pdfHasText(doc: PDFDocumentProxy): Promise<boolean> {
	let letters = 0;
	for (let i = 0; i < doc.numPages; i++) {
		letters += countLetters((await pageParagraphs(doc, i)).join(""));
		if (letters >= MIN_LETTERS) return true;
	}
	return false;
}

/** One chapter's pages as HTML (`<p>` only, escaped) and its read-aloud text. */
export async function pdfChapterContent(
	doc: PDFDocumentProxy,
	range: PdfChapterRange,
): Promise<{ html: string; text: string }> {
	const pages: string[][] = [];
	for (let i = range.start; i < range.end; i++) {
		pages.push(await pageParagraphs(doc, i));
	}
	const html = paragraphsToHtml(joinPdfPages(pages));
	return { html, text: htmlToPlainText(html) };
}
