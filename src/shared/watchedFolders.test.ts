import { describe, expect, test } from "bun:test";
import {
	coerceWatchedFolders,
	selectNewWatchedPaths,
} from "./watchedFolders";

const none = new Set<string>();

describe("selectNewWatchedPaths", () => {
	test("returns supported paths not in library or seen, in order", () => {
		const candidates = [
			{ path: "/w/a.epub" },
			{ path: "/w/b.txt" },
			{ path: "/w/c.epub" },
		];
		expect(selectNewWatchedPaths(candidates, none, none)).toEqual([
			"/w/a.epub",
			"/w/b.txt",
			"/w/c.epub",
		]);
	});

	test("drops paths already in the library", () => {
		const candidates = [{ path: "/w/a.epub" }, { path: "/w/b.txt" }];
		const library = new Set(["/w/a.epub"]);
		expect(selectNewWatchedPaths(candidates, library, none)).toEqual([
			"/w/b.txt",
		]);
	});

	test("drops paths already seen this session (e.g. removed from library)", () => {
		const candidates = [{ path: "/w/a.epub" }, { path: "/w/b.txt" }];
		const seen = new Set(["/w/b.txt"]);
		expect(selectNewWatchedPaths(candidates, none, seen)).toEqual([
			"/w/a.epub",
		]);
	});

	test("drops unsupported extensions and empty paths", () => {
		const candidates = [
			{ path: "/w/a.pdf" },
			{ path: "/w/b.mobi" },
			{ path: "" },
			{ path: "/w/c.EPUB" },
		];
		expect(selectNewWatchedPaths(candidates, none, none)).toEqual([
			"/w/c.EPUB",
		]);
	});

	test("dedupes within one snapshot", () => {
		const candidates = [
			{ path: "/w/a.epub" },
			{ path: "/w/a.epub" },
			{ path: "/w/b.txt" },
		];
		expect(selectNewWatchedPaths(candidates, none, none)).toEqual([
			"/w/a.epub",
			"/w/b.txt",
		]);
	});

	test("empty snapshot yields nothing", () => {
		expect(selectNewWatchedPaths([], none, none)).toEqual([]);
	});
});

describe("coerceWatchedFolders", () => {
	test("keeps non-empty strings, trimmed and deduped, in order", () => {
		expect(
			coerceWatchedFolders(["/a", " /b ", "/a", "", "   "]),
		).toEqual(["/a", "/b"]);
	});

	test("non-arrays and non-string entries become empty / are skipped", () => {
		expect(coerceWatchedFolders(undefined)).toEqual([]);
		expect(coerceWatchedFolders("nope")).toEqual([]);
		expect(coerceWatchedFolders([1, null, "/ok", {}])).toEqual(["/ok"]);
	});
});
