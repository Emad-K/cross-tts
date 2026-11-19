import { describe, expect, test } from "bun:test";
import { locateOffset, trimRange } from "./noteOffsets";

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
