import { describe, expect, test } from "bun:test";
import { htmlToPlainText } from "@shared/htmlPlainText";
import { buildTtsChunks } from "./chunkText";

describe("buildTtsChunks", () => {
	test("does not merge EPUB heading block with following paragraph", () => {
		const html =
			"<h3>Chapter 3: Mortal Desires For The Immortal</h3>" +
			"<p>Time seemed to have hit the accelerator button.</p>";
		const text = htmlToPlainText(html);
		const chunks = buildTtsChunks(text);

		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(chunks[0]!.text).toBe(
			"Chapter 3: Mortal Desires For The Immortal",
		);
		expect(chunks[1]!.text).toBe(
			"Time seemed to have hit the accelerator button.",
		);
	});

	test("still merges undersized sentences within the same block", () => {
		const text = "Hi.\nThere.";
		const chunks = buildTtsChunks(text);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.text).toBe("Hi.\nThere.");
	});

	test("does not split on abbreviations like U.S.A.", () => {
		const text =
			"For many years he lived peacefully in the U.S.A. in a small town. " +
			"Then he left home and traveled abroad for many years.";
		const chunks = buildTtsChunks(text);
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(chunks[0]!.text).toContain("U.S.A.");
		expect(chunks[0]!.text).not.toMatch(/U\.\s*$/);
		expect(chunks[1]!.text).toMatch(/^Then he left home/);
	});
});
