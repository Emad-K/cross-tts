import { describe, expect, test } from "bun:test";
import { wordIndexAtProgress, wordTimeline } from "./wordTiming";

const words = (text: string) =>
	wordTimeline(text).map((w) => text.slice(w.start, w.end));

describe("wordTimeline", () => {
	test("finds words without their punctuation", () => {
		expect(words("“Hello,” she said. Don't go!")).toEqual([
			"Hello",
			"she",
			"said",
			"Don't",
			"go",
		]);
	});

	test("shares rise to exactly 1 and longer words take longer", () => {
		const t = wordTimeline("a extraordinary b");
		expect(t.map((w) => w.until)).toEqual([1 / 15, 14 / 15, 1]);
	});

	test("punctuation adds a pause to the word before it", () => {
		// "one" 3 + clause pause 3, "two" 3 + sentence pause 6, "six" 3.
		const t = wordTimeline("one, two. six");
		expect(t.map((w) => w.until)).toEqual([6 / 18, 15 / 18, 1]);
	});

	test("an ellipsis or a closing quote is still one pause", () => {
		const t = wordTimeline("wait... “no.” ok");
		expect(t.map((w) => w.until)).toEqual([10 / 20, 18 / 20, 1]);
	});

	test("text without words yields nothing", () => {
		expect(wordTimeline("")).toEqual([]);
		expect(wordTimeline(" — … ")).toEqual([]);
	});

	test("splits scripts written without spaces", () => {
		expect(words("今日は良い天気です").length).toBeGreaterThan(1);
	});
});

describe("wordIndexAtProgress", () => {
	const t = wordTimeline("one, two. six");

	test("maps progress to the word being spoken", () => {
		expect(wordIndexAtProgress(t, 0)).toBe(0);
		expect(wordIndexAtProgress(t, 0.3)).toBe(0);
		expect(wordIndexAtProgress(t, 6 / 18)).toBe(1);
		expect(wordIndexAtProgress(t, 0.8)).toBe(1);
		expect(wordIndexAtProgress(t, 0.9)).toBe(2);
	});

	test("clamps out-of-range and invalid progress", () => {
		expect(wordIndexAtProgress(t, 1)).toBe(2);
		expect(wordIndexAtProgress(t, 7)).toBe(2);
		expect(wordIndexAtProgress(t, -1)).toBe(0);
		expect(wordIndexAtProgress(t, Number.NaN)).toBe(0);
		expect(wordIndexAtProgress([], 0.5)).toBe(-1);
	});
});
