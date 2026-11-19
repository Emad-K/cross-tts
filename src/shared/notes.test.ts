import { describe, expect, test } from "bun:test";
import {
	type Note,
	coerceNotesFile,
	mergeNotesFiles,
	notesToMarkdown,
	reanchor,
} from "./notes";

const note = (patch: Partial<Note>): Note => ({
	id: "n1",
	chapterId: null,
	start: 4,
	end: 9,
	text: "quick",
	color: "yellow",
	createdAt: 1,
	updatedAt: 1,
	...patch,
});

describe("reanchor", () => {
	test("keeps the saved offsets while the text is unchanged", () => {
		expect(reanchor(note({}), "The quick brown fox")).toEqual({ start: 4, end: 9 });
	});

	test("follows the snippet when text was inserted before it", () => {
		expect(reanchor(note({}), "Well. The quick brown fox")).toEqual({
			start: 10,
			end: 15,
		});
	});

	test("picks the occurrence closest to the saved offset", () => {
		const text = "quick one, then a quick two, and a quick three";
		expect(reanchor(note({ start: 20, end: 25 }), text)?.start).toBe(18);
		expect(reanchor(note({ start: 40, end: 45 }), text)?.start).toBe(35);
	});

	test("keeps the full length of a highlight longer than its snippet", () => {
		const text = `xx${"a".repeat(300)}`;
		const long = note({ start: 0, end: 300, text: "a".repeat(200) });
		expect(reanchor(long, text)).toEqual({ start: 2, end: 302 });
		expect(reanchor(long, "a".repeat(250))).toEqual({ start: 0, end: 250 });
	});

	test("is null when the passage is gone", () => {
		expect(reanchor(note({}), "Nothing to see here")).toBeNull();
	});
});

describe("coerceNotesFile", () => {
	test("drops malformed notes and duplicate ids, fixes bad colours", () => {
		const file = coerceNotesFile({
			version: 1,
			byPath: {
				"/a.txt": [
					note({}),
					note({}),
					note({ id: "n2", color: "purple" as never, note: "  " }),
					{ id: "n3", start: 5, end: 5, text: "x" },
					{ id: "n4", start: 1.5, end: 3, text: "x" },
					"junk",
				],
				"/empty.txt": [],
				"/bad.txt": "nope",
			},
		});
		expect(Object.keys(file.byPath)).toEqual(["/a.txt"]);
		expect(file.byPath["/a.txt"]!.map((n) => n.id)).toEqual(["n1", "n2"]);
		expect(file.byPath["/a.txt"]![1]!.color).toBe("yellow");
		expect(file.byPath["/a.txt"]![1]!.note).toBeUndefined();
	});

	test("returns an empty file for junk", () => {
		expect(coerceNotesFile(null).byPath).toEqual({});
		expect(coerceNotesFile({ byPath: [] }).byPath).toEqual({});
	});
});

describe("notesToMarkdown", () => {
	test("groups by chapter in book order and quotes the highlight", () => {
		const md = notesToMarkdown(
			"My Book",
			[
				note({ id: "b", chapterId: "c2", text: "second" }),
				note({ id: "a", chapterId: "c1", text: "first\nline", note: "Why?" }),
			],
			[
				{ id: "c1", title: "One" },
				{ id: "c2", title: "Two" },
			],
		);
		expect(md).toBe(
			"# Notes: My Book\n\n## One\n\n> first\n> line\n\nWhy?\n\n## Two\n\n> second\n",
		);
	});

	test("a .txt book has no chapter headings", () => {
		expect(notesToMarkdown("T", [note({})])).toBe("# Notes: T\n\n> quick\n");
	});
});

describe("mergeNotesFiles", () => {
	test("keeps the notes here and adds the ones only the backup has", () => {
		const mine = note({ id: "a", note: "mine" });
		const merged = mergeNotesFiles(
			{ version: 1, byPath: { "/a.epub": [mine] } },
			{
				version: 1,
				byPath: {
					"/a.epub": [note({ id: "a", note: "theirs" }), note({ id: "b" })],
					"/b.epub": [note({ id: "c" })],
				},
			},
		);
		expect(merged.byPath["/a.epub"]).toEqual([mine, note({ id: "b" })]);
		expect(merged.byPath["/b.epub"]).toEqual([note({ id: "c" })]);
	});
});
