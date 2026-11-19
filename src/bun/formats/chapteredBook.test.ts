import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { htmlToPlainText } from "../../shared/htmlPlainText";
import { convertToChapters, loadChapteredBook } from "./chapteredBook";

const fixture = (name: string) => join(import.meta.dir, "fixtures", name);
const bytes = (name: string) => new Uint8Array(readFileSync(fixture(name)));

/** Chapter text with paragraph breaks flattened, for readable expectations. */
const flat = (text: string) => text.replace(/\s+/g, " ");

/** What every converter must guarantee, whatever the input. */
function expectSafe(chapters: { html: string; text: string }[]): void {
	for (const { html, text } of chapters) {
		expect(html).not.toMatch(/<(script|style|img|iframe)\b/i);
		expect(html).not.toMatch(/\s(on\w+|href|src)\s*=/i);
		// Read-along highlights index into text derived from the served HTML.
		expect(text).toBe(htmlToPlainText(html));
	}
}

describe("Word (.docx)", () => {
	test("headings become chapters; h2 nests under h1", async () => {
		const { title, chapters } = await convertToChapters("docx", bytes("sample.docx"), "sample");
		expect(title).toBe("sample");
		expect(chapters.map((c) => [c.title, c.level])).toEqual([
			["sample", 0],
			["First Part", 0],
			["A Section", 1],
			["Second Part", 0],
		]);
		expect(flat(chapters[1]!.text)).toBe("First Part The first part has bold text.");
		// Markup typed into a Word document is text, never markup.
		expect(chapters[2]!.text).toContain("<script>alert(1)</script> stays text.");
		expectSafe(chapters);
	});
});

describe("HTML", () => {
	test("scripts, styles, images and links are stripped; title comes from <title>", async () => {
		const { title, chapters } = await convertToChapters("html", bytes("sample.html"), "sample");
		expect(title).toBe("An HTML Story");
		expect(chapters.map((c) => [c.title, c.level])).toEqual([
			["An HTML Story", 0],
			["Part One", 0],
			["A Section", 1],
			["Part Two", 0],
		]);
		const all = chapters.map((c) => c.text).join("\n");
		expect(all).not.toMatch(/stolen|steal|color: red|example\.com/);
		expect(flat(chapters[1]!.text)).toBe("Part One First part text with a link and an image .");
		expect(flat(chapters[2]!.text)).toBe("A Section Section text & more.");
		expectSafe(chapters);
	});

	test("a page without headings is one chapter", async () => {
		const html = new TextEncoder().encode("<p>Just one paragraph.</p>");
		const { chapters } = await convertToChapters("html", html, "notes");
		expect(chapters).toHaveLength(1);
		expect(chapters[0]).toMatchObject({ id: "s0", title: "notes", text: "Just one paragraph." });
	});

	test("honours <meta charset>", async () => {
		const head = '<meta charset="windows-1252"><p>caf';
		const html = new Uint8Array([...new TextEncoder().encode(head), 0xe9, ...new TextEncoder().encode("</p>")]);
		const { chapters } = await convertToChapters("html", html, "x");
		expect(chapters[0]!.text).toBe("café");
	});
});

describe("Markdown", () => {
	test("headings become chapters and markers are dropped", async () => {
		const { chapters } = await convertToChapters("md", bytes("sample.md"), "sample");
		expect(chapters.map((c) => [c.title, c.level])).toEqual([
			["sample", 0],
			["First Chapter", 0],
			["A Section", 1],
			["Second Chapter", 0],
		]);
		expect(chapters[0]!.text).toBe("Intro line before any heading, with bold, emphasis and code.");
		expect(flat(chapters[1]!.text)).toBe(
			[
				"First Chapter",
				"A paragraph with a link and an image that wraps onto a second line. Keep snake_case and 2 * 3 as they are.",
				"one item",
				"another item wrapped onto the next line",
			].join(" "),
		);
		// Code blocks are kept as text; raw HTML tags are removed.
		expect(chapters[2]!.text).toContain('const x = "<b>not html</b>";');
		expect(chapters[2]!.text).toContain("alert(1)");
		expect(flat(chapters[3]!.text)).toBe("Second Chapter A quoted closing line.");
		expectSafe(chapters);
	});
});

describe("loadChapteredBook", () => {
	test("serves chapters by id and re-reads a replaced file", async () => {
		const path = join(mkdtempSync(join(tmpdir(), "chaptered-")), "book.md");
		copyFileSync(fixture("sample.md"), path);
		const book = await loadChapteredBook(path);
		expect(book?.title).toBe("book");
		expect(book?.content.get("s3")?.text).toContain("A quoted closing line.");

		writeFileSync(path, "# Only\n\nA brand new single chapter, longer than before to change the size.\n".repeat(20));
		expect((await loadChapteredBook(path))?.chapters[0]?.title).toBe("Only");
	});

	test("missing files are null; unsupported kinds are null; empty files say so", async () => {
		expect(await loadChapteredBook("/nonexistent/book.docx")).toBeNull();
		expect(await loadChapteredBook(fixture("outline.pdf"))).toBeNull();
		const empty = join(mkdtempSync(join(tmpdir(), "chaptered-")), "empty.html");
		writeFileSync(empty, "<script>1</script>");
		expect(loadChapteredBook(empty)).rejects.toThrow("has no text to read");
	});
});

test("a file of unclosed <title tags is converted quickly and keeps the file's name", async () => {
	const bytes = new TextEncoder().encode(`${"<title".repeat(80_000)}<p>Hello.</p>`);
	const started = performance.now();
	const { title } = await convertToChapters("html", bytes, "from-file");
	expect(title).toBe("from-file");
	expect(performance.now() - started).toBeLessThan(2000);
});
