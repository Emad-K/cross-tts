import { describe, expect, test } from "bun:test";
import {
	type Bookmark,
	bookmarkId,
	coerceBookmarksByPath,
	hasBookmark,
	sortBookmarks,
	toggleBookmark,
} from "./bookmarks";

function bm(chapterId: string | null, chunkIndex: number, createdAt = 0): Bookmark {
	return {
		id: bookmarkId(chapterId, chunkIndex),
		chapterId,
		chunkIndex,
		label: `c${chunkIndex}`,
		createdAt,
	};
}

describe("toggleBookmark", () => {
	test("adds when absent, removes when present", () => {
		const a = toggleBookmark([], bm("ch1", 3));
		expect(a).toHaveLength(1);
		const b = toggleBookmark(a, bm("ch1", 3));
		expect(b).toHaveLength(0);
	});

	test("treats different positions as distinct", () => {
		let list: Bookmark[] = [];
		list = toggleBookmark(list, bm("ch1", 3));
		list = toggleBookmark(list, bm("ch1", 4));
		list = toggleBookmark(list, bm("ch2", 3));
		expect(list).toHaveLength(3);
	});

	test("does not mutate input", () => {
		const start = [bm("ch1", 1)];
		toggleBookmark(start, bm("ch1", 2));
		expect(start).toHaveLength(1);
	});
});

describe("hasBookmark", () => {
	test("detects an existing position", () => {
		const list = [bm("ch1", 5)];
		expect(hasBookmark(list, "ch1", 5)).toBe(true);
		expect(hasBookmark(list, "ch1", 6)).toBe(false);
		expect(hasBookmark(list, null, 5)).toBe(false);
	});
});

describe("sortBookmarks", () => {
	test("orders by chunk index", () => {
		const list = [bm("c", 9), bm("c", 2), bm("c", 5)];
		expect(sortBookmarks(list).map((b) => b.chunkIndex)).toEqual([2, 5, 9]);
	});
});

describe("coerceBookmarksByPath", () => {
	test("drops malformed entries and dedupes by id", () => {
		const raw = {
			"/a": [
				{ chapterId: "ch1", chunkIndex: 2, label: "x", createdAt: 1 },
				{ chapterId: "ch1", chunkIndex: 2 }, // dup id
				{ label: "no index" },
			],
			"/empty": [],
			"/bad": "nope",
		};
		const out = coerceBookmarksByPath(raw);
		expect(Object.keys(out)).toEqual(["/a"]);
		expect(out["/a"]).toHaveLength(1);
		expect(out["/a"]![0]!.chunkIndex).toBe(2);
	});

	test("returns empty for non-objects", () => {
		expect(coerceBookmarksByPath(null)).toEqual({});
	});
});
