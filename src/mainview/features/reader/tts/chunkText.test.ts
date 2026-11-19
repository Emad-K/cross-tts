import { describe, expect, test } from "bun:test";
import { htmlToPlainText } from "@shared/htmlPlainText";
import { isSpeakableChunkText } from "./ttsChunkText";
import { buildTtsChunks, chunkIndexAtOffset, splitForFastStart } from "./chunkText";

describe("chunkIndexAtOffset", () => {
	test("keeps the reading position across a re-chunk", () => {
		const text = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
		const small = buildTtsChunks(text, 60);
		const large = buildTtsChunks(text, 300);
		const old = small[7]!;
		const idx = chunkIndexAtOffset(large, old.start);
		expect(large[idx]!.start).toBeLessThanOrEqual(old.start);
		expect(large[idx]!.end).toBeGreaterThan(old.start);
		expect(chunkIndexAtOffset(large, 0)).toBe(0);
		expect(chunkIndexAtOffset([], 10)).toBe(0);
	});
});

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

describe("splitForFastStart", () => {
	test("splits a long chunk at its first clause", () => {
		const text =
			"He had promised the village council, after a long and stubborn debate, that he would map every bend of the water before winter came; nobody believed him, but he kept walking.";
		const parts = splitForFastStart(text);
		expect(parts).toEqual([
			"He had promised the village council, after a long and stubborn debate,",
			"that he would map every bend of the water before winter came; nobody believed him, but he kept walking.",
		]);
	});

	test("leaves short chunks and chunks without a break alone", () => {
		expect(splitForFastStart("A short sentence, really.")).toEqual([
			"A short sentence, really.",
		]);
		const noBreak = "x".repeat(300);
		expect(splitForFastStart(noBreak)).toEqual([noBreak]);
	});

	test("never splits mid-phrase at a plain space", () => {
		const text =
			"The old ferryman walked slowly toward the river where the boats had been tied since the spring floods and the water was still high and brown with mud.";
		expect(splitForFastStart(text)).toEqual([text]);
	});
});
