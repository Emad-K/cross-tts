import { describe, expect, test } from "bun:test";
import {
	type BookProgress,
	coerceRecentBooks,
	MAX_RECENT_BOOKS,
	recentBooksList,
	upsertRecentBook,
} from "./recentBooks";

function book(path: string, updatedAt: number, extra: Partial<BookProgress> = {}): BookProgress {
	return {
		path,
		title: path,
		format: "epub",
		chapterId: null,
		chunkIndex: 0,
		updatedAt,
		...extra,
	};
}

describe("upsertRecentBook", () => {
	test("adds a new book", () => {
		const out = upsertRecentBook({}, book("/a", 1));
		expect(Object.keys(out)).toEqual(["/a"]);
	});

	test("replaces an existing book by path", () => {
		const start = { "/a": book("/a", 1, { chunkIndex: 0 }) };
		const out = upsertRecentBook(start, book("/a", 2, { chunkIndex: 5 }));
		expect(Object.keys(out)).toHaveLength(1);
		expect(out["/a"]!.chunkIndex).toBe(5);
		expect(out["/a"]!.updatedAt).toBe(2);
	});

	test("prunes the least-recently-updated past the cap", () => {
		let books: Record<string, BookProgress> = {};
		books = upsertRecentBook(books, book("/a", 1), 2);
		books = upsertRecentBook(books, book("/b", 2), 2);
		books = upsertRecentBook(books, book("/c", 3), 2);
		expect(Object.keys(books).sort()).toEqual(["/b", "/c"]);
	});

	test("does not mutate the input", () => {
		const start = { "/a": book("/a", 1) };
		upsertRecentBook(start, book("/b", 2));
		expect(Object.keys(start)).toEqual(["/a"]);
	});

	test("default cap holds a large library", () => {
		expect(MAX_RECENT_BOOKS).toBe(1000);
		let books: Record<string, BookProgress> = {};
		for (let i = 0; i < 30; i++) {
			books = upsertRecentBook(books, book(`/b${i}`, i));
		}
		expect(Object.keys(books)).toHaveLength(30);
	});

	test("preserves existing tags/series when the new entry omits them", () => {
		const start = {
			"/a": book("/a", 1, { tags: ["fantasy"], series: "Discworld" }),
		};
		// Progress saves rebuild the entry without tags/series.
		const out = upsertRecentBook(start, book("/a", 2, { chunkIndex: 7 }));
		expect(out["/a"]!.tags).toEqual(["fantasy"]);
		expect(out["/a"]!.series).toBe("Discworld");
		expect(out["/a"]!.chunkIndex).toBe(7);
	});

	test("explicit tags/series on the new entry win over existing ones", () => {
		const start = {
			"/a": book("/a", 1, { tags: ["old"], series: "Old" }),
		};
		const out = upsertRecentBook(
			start,
			book("/a", 2, { tags: ["new"], series: "New" }),
		);
		expect(out["/a"]!.tags).toEqual(["new"]);
		expect(out["/a"]!.series).toBe("New");
	});
});

describe("recentBooksList", () => {
	test("orders most-recently-updated first", () => {
		const books = {
			"/a": book("/a", 1),
			"/b": book("/b", 3),
			"/c": book("/c", 2),
		};
		expect(recentBooksList(books).map((b) => b.path)).toEqual([
			"/b",
			"/c",
			"/a",
		]);
	});
});

describe("coerceRecentBooks", () => {
	test("drops malformed entries and keeps valid ones", () => {
		const raw = {
			"/a": { path: "/a", title: "A", format: "epub", chunkIndex: 3, updatedAt: 5 },
			"/bad": { title: "no path" },
			"/c": { path: "/c" },
		};
		const out = coerceRecentBooks(raw);
		expect(Object.keys(out).sort()).toEqual(["/a", "/c"]);
		expect(out["/a"]!.chunkIndex).toBe(3);
		expect(out["/c"]!.chunkIndex).toBe(0);
		expect(out["/c"]!.format).toBe("txt");
	});

	test("returns empty for non-objects", () => {
		expect(coerceRecentBooks(null)).toEqual({});
		expect(coerceRecentBooks("x")).toEqual({});
	});

	test("round-trips tags and series", () => {
		const raw = {
			"/a": {
				path: "/a",
				updatedAt: 1,
				series: "Discworld",
				tags: ["fantasy", "to-read"],
			},
		};
		const out = coerceRecentBooks(raw);
		expect(out["/a"]!.series).toBe("Discworld");
		expect(out["/a"]!.tags).toEqual(["fantasy", "to-read"]);
	});

	test("missing or malformed tags/series coerce to undefined (back-compat)", () => {
		const raw = {
			"/old": { path: "/old", updatedAt: 1 },
			"/bad": { path: "/bad", updatedAt: 1, series: "", tags: [1, "", {}] },
			"/mixed": { path: "/mixed", updatedAt: 1, tags: ["ok", 2, ""] },
		};
		const out = coerceRecentBooks(raw);
		expect(out["/old"]!.series).toBeUndefined();
		expect(out["/old"]!.tags).toBeUndefined();
		expect(out["/bad"]!.series).toBeUndefined();
		expect(out["/bad"]!.tags).toBeUndefined();
		expect(out["/mixed"]!.tags).toEqual(["ok"]);
	});
});
