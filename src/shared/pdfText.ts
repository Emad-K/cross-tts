/**
 * PDF text reconstruction, free of pdf.js so it can be unit tested. pdf.js
 * hands over positioned text runs; these functions turn them into paragraphs
 * and decide where chapters start.
 */

import { escapeHtml } from "./escapeHtml";

/** The fields of a pdf.js `TextItem` used here. */
export type PdfTextItem = {
	str: string;
	/** `[a, b, c, d, x, y]`; y grows upward from the bottom of the page. */
	transform: number[];
	height: number;
	hasEOL: boolean;
};

type Line = { text: string; y: number; h: number };

/** Join two pieces of running text, undoing a line-end hyphen ("exam-" + "ple"). */
function joinRunningText(a: string, b: string): string {
	// ponytail: also joins a real hyphenated compound broken at the line end
	// ("well-" + "known" → "wellknown"); telling them apart needs a dictionary.
	if (/\p{L}-$/u.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
	return `${a} ${b}`;
}

function tidy(text: string): string {
	return text
		.replace(/[\u00ad\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * One page's text runs → paragraphs, in the order the PDF stores them.
 *
 * Runs are never sorted by position: sorting by y would interleave the columns
 * of a two-column page, and PDFs made from real text keep reading order in the
 * content stream. A new line starts at pdf.js's end-of-line flag or when the
 * baseline moves; a new paragraph starts where the gap between two lines is
 * clearly larger than the page's usual line gap, where the type size changes,
 * or where the text jumps back up the page (the next column).
 *
 * ponytail: a PDF that marks paragraphs only by indenting the first line comes
 * out as one paragraph per page. Sentences still split correctly for speech;
 * use the run's x position if the on-screen paragraphs matter.
 */
export function pdfItemsToParagraphs(items: readonly PdfTextItem[]): string[] {
	const lines: Line[] = [];
	let cur: Line | null = null;
	const end = () => {
		if (cur && tidy(cur.text)) lines.push({ ...cur, text: tidy(cur.text) });
		cur = null;
	};
	for (const item of items) {
		if (item.str) {
			const y = item.transform[5] ?? 0;
			const h: number = item.height || Math.abs(item.transform[3] ?? 0) || cur?.h || 10;
			// Small shifts (superscripts, footnote marks) stay on the line.
			if (cur && Math.abs(y - cur.y) > 0.5 * Math.max(h, cur.h)) end();
			if (cur) {
				cur.text += item.str;
				cur.h = Math.max(cur.h, h);
			} else {
				cur = { text: item.str, y, h };
			}
		}
		if (item.hasEOL) end();
	}
	end();

	const gaps = lines
		.slice(1)
		.map((line, i) => lines[i]!.y - line.y)
		.filter((gap) => gap > 0)
		.sort((a, b) => a - b);
	// The lower quartile, not the median: on a page of short paragraphs most
	// gaps are paragraph gaps, and the line gap is the small one.
	const usualGap = gaps.length >= 3 ? gaps[Math.floor(gaps.length / 4)]! : null;

	const paragraphs: string[] = [];
	lines.forEach((line, i) => {
		const prev = lines[i - 1];
		const gap = prev ? prev.y - line.y : 0;
		const h = prev ? Math.max(prev.h, line.h) : line.h;
		const breakBefore =
			!prev ||
			gap < -0.5 * h ||
			// A change of type size: a heading above or below body text.
			Math.abs(prev.h - line.h) > 0.15 * h ||
			gap > (usualGap !== null ? 1.4 * usualGap : 1.8 * h);
		if (breakBefore) paragraphs.push(line.text);
		else {
			const last = paragraphs.length - 1;
			paragraphs[last] = joinRunningText(paragraphs[last]!, line.text);
		}
	});
	return paragraphs;
}

/**
 * Paragraphs of consecutive pages as one list. A paragraph cut by a page break
 * (no closing punctuation, next page starts in lower case) is stitched back.
 */
export function joinPdfPages(pages: readonly (readonly string[])[]): string[] {
	const out: string[] = [];
	for (const page of pages) {
		page.forEach((paragraph, i) => {
			const last = out[out.length - 1];
			if (
				i === 0 &&
				last !== undefined &&
				!/[.!?…:;"”’»)\]]$/.test(last) &&
				/^\p{Ll}/u.test(paragraph)
			) {
				out[out.length - 1] = joinRunningText(last, paragraph);
			} else {
				out.push(paragraph);
			}
		});
	}
	return out;
}

/** Paragraphs as the HTML the reader renders: escaped text in `<p>`, nothing else. */
export function paragraphsToHtml(paragraphs: readonly string[]): string {
	return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
}

/** Number of letters in a string: how scanned (image-only) PDFs are spotted. */
export function countLetters(text: string): number {
	return text.match(/\p{L}/gu)?.length ?? 0;
}

export type PdfOutlineEntry = { title: string; pageIndex: number };

export type PdfChapterRange = {
	id: string;
	title: string;
	/** First page, 0-based. */
	start: number;
	/** One past the last page. */
	end: number;
};

export const PDF_PAGES_PER_GROUP = 10;

/**
 * Chapters as page ranges: from the PDF's top-level outline (bookmarks) when it
 * names at least two different pages, otherwise fixed groups of pages.
 * A chapter always starts at the top of a page.
 */
export function pdfChapterRanges(
	outline: readonly PdfOutlineEntry[],
	pageCount: number,
): PdfChapterRange[] {
	if (pageCount <= 0) return [];
	const starts: PdfOutlineEntry[] = [];
	for (const entry of [...outline].sort((a, b) => a.pageIndex - b.pageIndex)) {
		const valid =
			Number.isInteger(entry.pageIndex) &&
			entry.pageIndex >= 0 &&
			entry.pageIndex < pageCount;
		// Two entries on one page: the first names the chapter.
		if (valid && starts[starts.length - 1]?.pageIndex !== entry.pageIndex) {
			starts.push(entry);
		}
	}

	if (starts.length >= 2) {
		if (starts[0]!.pageIndex > 0) {
			starts.unshift({ title: "Front matter", pageIndex: 0 });
		}
		return starts.map((entry, i) => ({
			id: `p${entry.pageIndex}`,
			title: entry.title.replace(/\s+/g, " ").trim() || `Page ${entry.pageIndex + 1}`,
			start: entry.pageIndex,
			end: starts[i + 1]?.pageIndex ?? pageCount,
		}));
	}

	const ranges: PdfChapterRange[] = [];
	for (let start = 0; start < pageCount; start += PDF_PAGES_PER_GROUP) {
		const end = Math.min(pageCount, start + PDF_PAGES_PER_GROUP);
		ranges.push({
			id: `p${start}`,
			title: end - start === 1 ? `Page ${end}` : `Pages ${start + 1}–${end}`,
			start,
			end,
		});
	}
	return ranges;
}
