import { describe, expect, test } from "bun:test";
import {
	type BookProgress,
	coerceRecentBooks,
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
});
