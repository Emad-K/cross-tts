import { describe, expect, test } from "bun:test";
import { chapterLength, locateOffset, shownOffset, trimRange } from "./noteOffsets";

// "One two.  Three four." with a two-space gap at 8..10 between the chunks.
const chunks = [
	{ index: 0, start: 0, end: 8 },
	{ index: 1, start: 10, end: 21 },
];

describe("locateOffset", () => {
	test("inside a chunk", () => {
		expect(locateOffset(chunks, 4, "start")).toEqual({ index: 0, local: 4 });
		expect(locateOffset(chunks, 14, "end")).toEqual({ index: 1, local: 4 });
	});

	test("a chunk boundary belongs to the next chunk at a start, the previous at an end", () => {
		expect(locateOffset(chunks, 10, "start")).toEqual({ index: 1, local: 0 });
		expect(locateOffset(chunks, 10, "end")).toEqual({ index: 0, local: 8 });
		expect(locateOffset(chunks, 8, "end")).toEqual({ index: 0, local: 8 });
	});

	test("an offset in the gap snaps forward for a start and back for an end", () => {
		expect(locateOffset(chunks, 9, "start")).toEqual({ index: 1, local: 0 });
		expect(locateOffset(chunks, 9, "end")).toEqual({ index: 0, local: 8 });
	});

	test("nothing before the first chunk ends, nothing after the last starts", () => {
		expect(locateOffset(chunks, 0, "end")).toBeNull();
		expect(locateOffset(chunks, 21, "start")).toBeNull();
		expect(locateOffset([], 3, "start")).toBeNull();
	});
});

test("trimRange drops surrounding whitespace and clamps to the text", () => {
	expect(trimRange("  hi there \n", 0, 99)).toEqual({ start: 2, end: 10 });
	expect(trimRange("a   b", 1, 4)).toBeNull();
	expect(trimRange("abc", 2, 1)).toBeNull();
});

describe("a chunk shown with more spaces than the chapter text has", () => {
	// Chapter text: "Hi.  Bye now" collapses to "Hi. Bye now".
	const shown = "Hi.  Bye now";

	test("a point on screen maps to the chapter offset", () => {
		expect(chapterLength(shown, 5)).toBe(4); // before "Bye"
		expect("Hi. Bye now".slice(chapterLength(shown, 5), chapterLength(shown))).toBe(
			"Bye now",
		);
	});

	test("and back, so the highlight covers what the note quotes", () => {
		const from = shownOffset(shown, 4, "start");
		const to = shownOffset(shown, 11, "end");
		expect(shown.slice(from, to)).toBe("Bye now");
		// A range that ends on the collapsed run stops before it.
		expect(shown.slice(0, shownOffset(shown, 3, "end"))).toBe("Hi.");
	});

	test("text with nothing collapsed maps one to one", () => {
		expect(chapterLength("Bye now", 3)).toBe(3);
		expect(shownOffset("Bye now", 3, "start")).toBe(3);
		expect(shownOffset("Bye now", 99, "end")).toBe(7);
	});
});
