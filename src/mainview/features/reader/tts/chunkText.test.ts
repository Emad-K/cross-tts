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
});
