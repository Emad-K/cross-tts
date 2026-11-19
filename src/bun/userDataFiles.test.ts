import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUserDataFile, writeUserDataFile } from "./userDataFiles";

const dir = mkdtempSync(join(tmpdir(), "cross-tts-user-data-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const note = {
	id: "n1",
	chapterId: null,
	start: 0,
	end: 5,
	text: "hello",
	color: "green",
	createdAt: 1,
	updatedAt: 1,
};

describe("user data files", () => {
	test("missing file reads as null", () => {
		expect(readUserDataFile(dir, "notes")).toBeNull();
	});

	test("round-trips notes, dropping anything malformed", () => {
		writeUserDataFile(dir, "notes", {
			version: 1,
			byPath: { "/a.txt": [note, { id: "bad" }] },
			extra: "<script>",
		});
		expect(readUserDataFile(dir, "notes")).toEqual({
			version: 1,
			byPath: { "/a.txt": [note] },
		});
		expect(readFileSync(join(dir, "notes.json"), "utf8")).not.toContain("script");
	});

	test("only allowlisted names map to files", () => {
		for (const name of ["../app-config", "app-session", "constructor", 3, undefined]) {
			expect(() => readUserDataFile(dir, name)).toThrow();
			expect(() => writeUserDataFile(dir, name, {})).toThrow();
		}
		expect(readdirSync(dir).sort()).toEqual(["notes.json"]);
	});

	test("a corrupt file is backed up and reads as null", () => {
		writeFileSync(join(dir, "reading-stats.json"), "{not json");
		expect(readUserDataFile(dir, "stats")).toBeNull();
		expect(readdirSync(dir).some((f) => f.includes(".corrupt-"))).toBe(true);
	});
});
