import { describe, expect, test } from "bun:test";
import { defaultAppearance } from "./appearance";
import {
	type BackupLibrary,
	backupSummary,
	buildBackup,
	isUnsafePath,
	mergeBackup,
	parseBackup,
} from "./backup";
import type { BookProgress } from "./recentBooks";
import { defaultShortcutBindings } from "./shortcuts";
import {
	type RegexReplaceRule,
	defaultTtsTextRulesState,
} from "./ttsTextRules";

const book = (path: string, over: Partial<BookProgress> = {}): BookProgress => ({
	path,
	title: path,
	format: "epub",
	chapterId: "c1",
	chunkIndex: 3,
	updatedAt: 100,
	...over,
});

const regex = (id: string, over: Partial<RegexReplaceRule> = {}): RegexReplaceRule => ({
	id,
	kind: "regex",
	label: id,
	pattern: `${id}+`,
	replacement: "",
	enabled: true,
	caseSensitive: false,
	builtIn: false,
	...over,
});

const library = (over: Partial<BackupLibrary> = {}): BackupLibrary => ({
	books: {},
	bookmarks: {},
	rules: defaultTtsTextRulesState(),
	...over,
});

const settings = {
	appearance: { ...defaultAppearance(), mode: "dark" as const },
	shortcuts: defaultShortcutBindings(),
	shortcutsEnabled: true,
	watchedFolders: ["/books"],
	keepPlayingInBackground: true,
};

const fileFor = (lib: BackupLibrary) =>
	JSON.stringify(
		buildBackup({
			library: lib,
			settings,
			extra: { notes: { version: 1 } },
			appVersion: "1.15.0",
			now: new Date("2026-11-19T10:00:00Z"),
		}),
	);

describe("backup round trip", () => {
	test("keeps books, positions, per-book voice, bookmarks, rules and settings", () => {
		const defaults = defaultTtsTextRulesState();
		const lib = library({
			books: {
				"/a.epub": book("/a.epub", {
					engine: "kokoro",
					voice: "af_heart",
					speed: 1.2,
					tags: ["sf"],
				}),
			},
			bookmarks: {
				"/a.epub": [
					{ id: "c1#3", chapterId: "c1", chunkIndex: 3, label: "x", createdAt: 1 },
				],
			},
			rules: {
				regexRules: [...defaults.regexRules, regex("mine")],
				pronunciationRules: defaults.pronunciationRules,
			},
		});
		const parsed = parseBackup(fileFor(lib));
		if (!parsed.ok) throw new Error(parsed.error);
		expect(parsed.data.books).toEqual(lib.books);
		expect(parsed.data.bookmarks).toEqual(lib.bookmarks);
		expect(parsed.data.rules).toEqual(lib.rules);
		expect(parsed.data.settings).toEqual(settings);
		expect(parsed.data.extra).toEqual({ notes: { version: 1 } });
		expect(backupSummary(parsed.data)).toEqual({
			books: 1,
			bookmarks: 1,
			rules: 1,
			createdAt: "2026-11-19T10:00:00.000Z",
		});
	});
});

describe("parseBackup rejects and cleans", () => {
	test("isUnsafePath allows only plain local absolute paths", () => {
		for (const p of [
			"\\??\\UNC\\host\\share\\a.epub",
			"/??/UNC/host/share/a.epub",
			"C:a.epub",
			"a.epub",
			"\\\\host\\share\\a.epub",
			"//host/share/a.epub",
			"\\/host/share/a.epub",
			"/\\host\\share\\a.epub",
			"\\\\?\\UNC\\host\\share\\a.epub",
			"\\\\.\\pipe\\x",
		]) {
			expect(isUnsafePath(p)).toBe(true);
		}
		for (const p of ["/home/u/a.epub", "C:\\Books\\a.epub", "C:/Books/a.epub"]) {
			expect(isUnsafePath(p)).toBe(false);
		}
	});

	test("other files", () => {
		for (const text of ["not json", "[]", "{}", '{"format":"cross-tts-tts-rules","version":1}']) {
			expect(parseBackup(text).ok).toBe(false);
		}
	});

	test("network paths are dropped, so restoring never contacts a host the file names", () => {
		const unc = "\\\\evil\\share\\a.epub";
		const bm = { id: "b", chapterId: "c1", chunkIndex: 0, createdAt: 1 };
		const file = JSON.parse(
			fileFor(
				library({
					books: { [unc]: book(unc), "/ok.epub": book("/ok.epub") },
					bookmarks: { "//evil/share/b.epub": [bm], "/ok.epub": [bm] },
				}),
			),
		);
		file.settings.watchedFolders = ["\\\\evil\\share", "//evil/share", "/books"];
		const r = parseBackup(JSON.stringify(file));
		if (!r.ok) throw new Error(r.error);
		expect(Object.keys(r.data.books)).toEqual(["/ok.epub"]);
		expect(Object.keys(r.data.bookmarks)).toEqual(["/ok.epub"]);
		expect(r.data.settings?.watchedFolders).toEqual(["/books"]);
	});

	test("a backup from a newer version", () => {
		const r = parseBackup('{"format":"cross-tts-backup","version":2}');
		expect(r).toEqual({
			ok: false,
			error: expect.stringContaining("newer version") as unknown as string,
		});
	});

	test("malformed parts are dropped, not trusted", () => {
		const r = parseBackup(
			JSON.stringify({
				format: "cross-tts-backup",
				version: 1,
				books: { x: { path: "" }, y: book("/ok.txt", { speed: 99 }), z: "no" },
				bookmarks: { "/ok.txt": [{ chunkIndex: -1 }, { chunkIndex: 2 }] },
				rules: {
					regexRules: [
						regex("bad", { pattern: "(" }),
						// A file can't replace a built-in pattern or pose as built in.
						regex("builtin-urls", { pattern: "(a+)+$", enabled: false }),
						regex("fake", { builtIn: true }),
					],
				},
				settings: { appearance: { mode: "neon" }, watchedFolders: [1, " /b "] },
				extra: "nope",
			}),
		);
		if (!r.ok) throw new Error(r.error);
		expect(Object.keys(r.data.books)).toEqual(["/ok.txt"]);
		expect(r.data.books["/ok.txt"]?.speed).toBeUndefined();
		expect(r.data.bookmarks["/ok.txt"]?.map((b) => b.chunkIndex)).toEqual([2]);
		const urls = r.data.rules.regexRules.find((x) => x.id === "builtin-urls");
		const real = defaultTtsTextRulesState().regexRules.find(
			(x) => x.id === "builtin-urls",
		);
		expect(urls).toEqual({ ...real!, enabled: false });
		expect(r.data.rules.regexRules.some((x) => x.id === "bad")).toBe(false);
		expect(r.data.rules.regexRules.find((x) => x.id === "fake")?.builtIn).toBe(false);
		expect(r.data.settings?.appearance).toEqual(defaultAppearance());
		expect(r.data.settings?.watchedFolders).toEqual(["/b"]);
		expect(r.data.settings?.shortcutsEnabled).toBe(false);
		expect(r.data.extra).toEqual({});
	});

	test("no settings in the file means none to restore", () => {
		const r = parseBackup('{"format":"cross-tts-backup","version":1}');
		expect(r.ok && r.data.settings).toBeNull();
	});
});

describe("mergeBackup", () => {
	const defaults = defaultTtsTextRulesState();

	test("merge: the more recently read copy of a book wins, tags survive", () => {
		const current = library({
			books: {
				"/a": book("/a", { chunkIndex: 9, updatedAt: 200, tags: ["mine"] }),
				"/b": book("/b", { chunkIndex: 1, updatedAt: 100, tags: ["keep"] }),
				"/only-here": book("/only-here"),
			},
		});
		const incoming = library({
			books: {
				"/a": book("/a", { chunkIndex: 2, updatedAt: 150 }),
				"/b": book("/b", { chunkIndex: 7, updatedAt: 300 }),
				"/only-there": book("/only-there"),
			},
		});
		const { books } = mergeBackup(current, incoming, "merge");
		expect(Object.keys(books).sort()).toEqual(["/a", "/b", "/only-here", "/only-there"]);
		expect(books["/a"]?.chunkIndex).toBe(9);
		expect(books["/b"]?.chunkIndex).toBe(7);
		expect(books["/b"]?.tags).toEqual(["keep"]);
	});

	test("merge: bookmarks are joined by id", () => {
		const bm = (id: string, label: string) => ({
			id,
			chapterId: null,
			chunkIndex: 1,
			label,
			createdAt: 0,
		});
		const { bookmarks } = mergeBackup(
			library({ bookmarks: { "/a": [bm("1", "mine")] } }),
			library({ bookmarks: { "/a": [bm("1", "theirs"), bm("2", "new")], "/b": [bm("3", "b")] } }),
			"merge",
		);
		expect(bookmarks["/a"]?.map((b) => b.label)).toEqual(["mine", "new"]);
		expect(bookmarks["/b"]?.length).toBe(1);
	});

	test("merge: adds rules by id and keeps this app's built-in switches", () => {
		const off = defaults.regexRules.map((r) => ({ ...r, enabled: false }));
		const current = library({
			rules: { ...defaults, regexRules: [...defaults.regexRules, regex("a")] },
		});
		const incoming = library({
			rules: { ...defaults, regexRules: [...off, regex("a", { label: "theirs" }), regex("b")] },
		});
		const merged = mergeBackup(current, incoming, "merge");
		const custom = merged.rules.regexRules.filter((r) => !r.builtIn);
		expect(custom.map((r) => r.label)).toEqual(["a", "b"]);
		expect(merged.rules.regexRules.filter((r) => r.builtIn)).toEqual(defaults.regexRules);
		// "b" is new to this app: it arrives switched off.
		expect(custom[1]?.enabled).toBe(false);
		expect(merged.rulesSwitchedOff).toBe(1);
	});

	test("replace: takes the backup, but only already-running regex stays on", () => {
		const current = library({
			books: { "/gone": book("/gone") },
			rules: { ...defaults, regexRules: [...defaults.regexRules, regex("a")] },
		});
		const incoming = library({
			books: { "/new": book("/new") },
			rules: {
				...defaults,
				regexRules: [
					...defaults.regexRules.map((r) => ({ ...r, enabled: false })),
					regex("other-id", { pattern: "a+" }),
					regex("evil", { pattern: "(x+)+$" }),
					regex("was-off", { enabled: false }),
				],
			},
		});
		const merged = mergeBackup(current, incoming, "replace");
		expect(Object.keys(merged.books)).toEqual(["/new"]);
		const byId = Object.fromEntries(merged.rules.regexRules.map((r) => [r.id, r.enabled]));
		expect(byId["other-id"]).toBe(true);
		expect(byId["evil"]).toBe(false);
		expect(byId["builtin-urls"]).toBe(false);
		expect(merged.rulesSwitchedOff).toBe(1);
	});
});
