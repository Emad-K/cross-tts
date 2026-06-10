import { describe, expect, test } from "bun:test";
import type { BookProgress } from "@shared/recentBooks";
import {
	collectLibraryTags,
	filterLibrary,
	parseTagsInput,
	sortLibrary,
} from "./libraryFilters";

function book(
	path: string,
	title: string,
	extra: Partial<BookProgress> = {},
): BookProgress {
	return {
		path,
		title,
		format: "epub",
		chapterId: null,
		chunkIndex: 0,
		updatedAt: 0,
		...extra,
	};
}

describe("sortLibrary", () => {
	const list = [
		book("/b", "Banana", { progress: 0.2 }),
		book("/a", "apple", { progress: 0.9 }),
		book("/c", "Cherry", {}),
	];

	test("recent keeps the input order", () => {
		expect(sortLibrary(list, "recent").map((b) => b.path)).toEqual([
			"/b",
			"/a",
			"/c",
		]);
	});

	test("title sorts A–Z, case-insensitive", () => {
		expect(sortLibrary(list, "title").map((b) => b.title)).toEqual([
			"apple",
			"Banana",
			"Cherry",
		]);
	});

	test("progress sorts most-read first; missing progress counts as 0", () => {
		expect(sortLibrary(list, "progress").map((b) => b.path)).toEqual([
			"/a",
			"/b",
			"/c",
		]);
	});

	test("does not mutate the input", () => {
		sortLibrary(list, "title");
		expect(list[0]!.path).toBe("/b");
	});
});

describe("filterLibrary", () => {
	const list = [
		book("/a", "Guards! Guards!", { series: "Discworld", tags: ["fantasy"] }),
		book("/b", "Dune", { tags: ["sci-fi", "classic"] }),
		book("/c", "Plain Notes", {}),
	];

	test("empty query and no tag returns everything", () => {
		expect(filterLibrary(list, "")).toHaveLength(3);
	});

	test("matches title case-insensitively", () => {
		expect(filterLibrary(list, "dUnE").map((b) => b.path)).toEqual(["/b"]);
	});

	test("matches series and tags in the text query", () => {
		expect(filterLibrary(list, "discworld").map((b) => b.path)).toEqual(["/a"]);
		expect(filterLibrary(list, "classic").map((b) => b.path)).toEqual(["/b"]);
	});

	test("tag chip filters by exact tag or series", () => {
		expect(filterLibrary(list, "", "sci-fi").map((b) => b.path)).toEqual(["/b"]);
		expect(filterLibrary(list, "", "Discworld").map((b) => b.path)).toEqual([
			"/a",
		]);
	});

	test("combines tag and text query", () => {
		expect(filterLibrary(list, "guards", "fantasy").map((b) => b.path)).toEqual(
			["/a"],
		);
		expect(filterLibrary(list, "dune", "fantasy")).toEqual([]);
	});
});

describe("collectLibraryTags", () => {
	test("collects distinct tags and series, sorted A–Z", () => {
		const list = [
			book("/a", "A", { series: "Discworld", tags: ["fantasy"] }),
			book("/b", "B", { tags: ["fantasy", "classic"] }),
			book("/c", "C", {}),
		];
		expect(collectLibraryTags(list)).toEqual([
			"classic",
			"Discworld",
			"fantasy",
		]);
	});

	test("empty library has no tags", () => {
		expect(collectLibraryTags([])).toEqual([]);
	});
});

describe("parseTagsInput", () => {
	test("splits on commas, trims, and drops empties", () => {
		expect(parseTagsInput(" fantasy , to-read,,  ")).toEqual([
			"fantasy",
			"to-read",
		]);
	});

	test("de-duplicates", () => {
		expect(parseTagsInput("a, b, a")).toEqual(["a", "b"]);
	});

	test("empty input parses to no tags", () => {
		expect(parseTagsInput("")).toEqual([]);
	});
});
