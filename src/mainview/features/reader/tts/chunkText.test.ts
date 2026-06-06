import { describe, expect, test } from "bun:test";
import { htmlToPlainText } from "@shared/htmlPlainText";
import { isSpeakableChunkText } from "./ttsChunkText";
import { buildTtsChunks } from "./chunkText";

describe("buildTtsChunks", () => {
	test("drops the chapter heading and keeps the paragraph as its own chunk", () => {
		// The builtin chapter-heading rule removes "Chapter 3: …" from speech, so
		// the heading is filtered rather than merged into the following paragraph.
		// The invariant that matters: the paragraph chunk must not absorb the
		// heading text.
		const html =
			"<h3>Chapter 3: Mortal Desires For The Immortal</h3>" +
			"<p>Time seemed to have hit the accelerator button.</p>";
		const text = htmlToPlainText(html);
		const chunks = buildTtsChunks(text);

		expect(chunks.some((c) => c.text.includes("Chapter 3"))).toBe(false);
		expect(
			chunks.some(
				(c) => c.text === "Time seemed to have hit the accelerator button.",
			),
		).toBe(true);
	});

	test("still merges undersized sentences within the same block", () => {
		const text = "Hi.\nThere.";
		const chunks = buildTtsChunks(text);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.text).toBe("Hi.\nThere.");
	});

	test("drops chunks empty after TTS text rules (e.g. separator lines)", () => {
		const text = "Hello world.\n\n====\n\nThen he left.";
		const chunks = buildTtsChunks(text);
		expect(chunks.some((c) => c.text === "====")).toBe(false);
		expect(chunks.every((c) => isSpeakableChunkText(c.text))).toBe(true);
		expect(chunks.some((c) => c.text.includes("Hello"))).toBe(true);
		expect(chunks.some((c) => c.text.includes("Then he"))).toBe(true);
	});

	test("isSpeakableChunkText rejects punctuation-only lines", () => {
		expect(isSpeakableChunkText("====")).toBe(false);
		expect(isSpeakableChunkText("...")).toBe(false);
		expect(isSpeakableChunkText("Hello")).toBe(true);
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
