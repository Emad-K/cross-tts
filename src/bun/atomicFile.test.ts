import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupUnreadableFile, writeFileAtomic } from "./atomicFile";

describe("atomicFile", () => {
	test("writeFileAtomic replaces content and leaves no temp file", () => {
		const dir = mkdtempSync(join(tmpdir(), "atomic-"));
		const p = join(dir, "a.json");
		writeFileAtomic(p, "one");
		writeFileAtomic(p, "two");
		expect(readFileSync(p, "utf8")).toBe("two");
		expect(readdirSync(dir)).toEqual(["a.json"]);
	});

	test("backupUnreadableFile keeps one copy per broken version", () => {
		const dir = mkdtempSync(join(tmpdir(), "atomic-"));
		const p = join(dir, "s.json");
		writeFileSync(p, "{broken");
		const bak = backupUnreadableFile(p);
		expect(bak).not.toBeNull();
		expect(backupUnreadableFile(p)).toBe(bak);
		expect(readFileSync(bak as string, "utf8")).toBe("{broken");
		expect(readdirSync(dir).length).toBe(2);
		expect(backupUnreadableFile(join(dir, "missing"))).toBeNull();
	});
});
