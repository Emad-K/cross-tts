import { describe, expect, test } from "bun:test";
import {
	countLetters,
	joinPdfPages,
	paragraphsToHtml,
	pdfChapterRanges,
	pdfItemsToParagraphs,
	type PdfTextItem,
} from "./pdfText";

/** A 12pt text run at (x, y); `eol` marks the end of its line. */
const run = (str: string, y: number, eol = true, x = 72): PdfTextItem => ({
	str,
	transform: [12, 0, 0, 12, x, y],
	height: 12,
	hasEOL: eol,
});

describe("pdfItemsToParagraphs", () => {
	test("joins runs into lines and lines into paragraphs at larger gaps", () => {
		const items = [
			run("The quick ", 700, false),
			run("brown fox", 700),
			run("jumps over", 686),
			run("the lazy dog.", 672),
			run("A new paragraph", 644), // double gap
			run("ends here.", 630),
		];
		expect(pdfItemsToParagraphs(items)).toEqual([
			"The quick brown fox jumps over the lazy dog.",
			"A new paragraph ends here.",
		]);
	});

	test("starts a line when the baseline moves without an end-of-line flag", () => {
		const items = [run("one", 700, false), run("two", 686, false), run("three", 672, false)];
		expect(pdfItemsToParagraphs(items)).toEqual(["one two three"]);
	});

	test("keeps a superscript on its line", () => {
		const items = [run("claim", 700, false), { ...run("1", 704, false), height: 7 }, run(" holds.", 700)];
		expect(pdfItemsToParagraphs(items)).toEqual(["claim1 holds."]);
	});

	test("rejoins a word hyphenated at the line end, keeps other hyphens", () => {
		const items = [
			run("an exam-", 700),
			run("ple and a range of 5-", 686),
			run("10 and a dash -", 672),
			run("word.", 658),
		];
		expect(pdfItemsToParagraphs(items)).toEqual([
			"an example and a range of 5- 10 and a dash - word.",
		]);
	});

	test("keeps columns apart: a jump back up the page starts a new paragraph", () => {
		const items = [
			run("left one", 700),
			run("left two", 686),
			run("left three", 672),
			run("right one", 700, true, 320),
			run("right two", 686, true, 320),
		];
		expect(pdfItemsToParagraphs(items)).toEqual([
			"left one left two left three",
			"right one right two",
		]);
	});

	test("double-spaced text is not split at every line", () => {
		const items = [700, 672, 644, 616].map((y, i) => run(`line ${i + 1}`, y));
		expect(pdfItemsToParagraphs(items)).toEqual(["line 1 line 2 line 3 line 4"]);
	});

	test("a heading in larger type is its own paragraph", () => {
		const items = [{ ...run("Heading", 700), height: 18 }, run("Body text", 684), run("goes on.", 670)];
		expect(pdfItemsToParagraphs(items)).toEqual(["Heading", "Body text goes on."]);
	});

	test("drops empty runs, soft hyphens and control characters", () => {
		const items = [run("", 700), run("co\u00adoperate\u0000 now", 686), run("   ", 672)];
		expect(pdfItemsToParagraphs(items)).toEqual(["cooperate now"]);
		expect(pdfItemsToParagraphs([])).toEqual([]);
	});
});

describe("joinPdfPages", () => {
	test("stitches a paragraph cut by a page break", () => {
		expect(
			joinPdfPages([["Intro.", "The sentence runs"], ["over the page.", "Next."], [], ["Last."]]),
		).toEqual(["Intro.", "The sentence runs over the page.", "Next.", "Last."]);
	});

	test("does not join across a finished sentence or into a capital", () => {
		expect(joinPdfPages([["Done."], ["next"]])).toEqual(["Done.", "next"]);
		expect(joinPdfPages([["Chapter 1"], ["The start"]])).toEqual(["Chapter 1", "The start"]);
	});
});

test("paragraphsToHtml escapes text", () => {
	expect(paragraphsToHtml(["a < b & c", "<script>x</script>"])).toBe(
		"<p>a &lt; b &amp; c</p>\n<p>&lt;script&gt;x&lt;/script&gt;</p>",
	);
});

test("countLetters counts letters in any script, not digits or marks", () => {
	expect(countLetters("Ab 12 — é 日本")).toBe(5);
	expect(countLetters("")).toBe(0);
});

describe("pdfChapterRanges", () => {
	test("uses the outline, sorted, with front matter before the first entry", () => {
		const ranges = pdfChapterRanges(
			[
				{ title: "Two", pageIndex: 7 },
				{ title: " One\n", pageIndex: 2 },
				{ title: "Also on page 3", pageIndex: 2 },
				{ title: "Broken", pageIndex: 99 },
			],
			10,
		);
		expect(ranges).toEqual([
			{ id: "p0", title: "Front matter", start: 0, end: 2 },
			{ id: "p2", title: "One", start: 2, end: 7 },
			{ id: "p7", title: "Two", start: 7, end: 10 },
		]);
	});

	test("falls back to groups of ten pages", () => {
		expect(pdfChapterRanges([], 21).map((r) => r.title)).toEqual([
			"Pages 1–10",
			"Pages 11–20",
			"Page 21",
		]);
		// One usable outline entry isn't a table of contents.
		expect(pdfChapterRanges([{ title: "Cover", pageIndex: 0 }], 3)).toEqual([
			{ id: "p0", title: "Pages 1–3", start: 0, end: 3 },
		]);
		expect(pdfChapterRanges([], 0)).toEqual([]);
	});
});
