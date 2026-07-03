import { describe, expect, test } from "bun:test";
import { splitPhonemesForTokenLimit } from "./phonemeTokenSplit";

describe("splitPhonemesForTokenLimit", () => {
	test("returns short input unchanged", () => {
		expect(splitPhonemesForTokenLimit("həlˈoʊ wˈɜːld", 500)).toEqual([
			"həlˈoʊ wˈɜːld",
		]);
	});

	test("returns input exactly at the limit unchanged", () => {
		const s = "a".repeat(500);
		expect(splitPhonemesForTokenLimit(s, 500)).toEqual([s]);
	});

	test("splits after punctuation when one is in range", () => {
		const s = `${"a".repeat(10)}.${"b".repeat(10)}`;
		expect(splitPhonemesForTokenLimit(s, 15)).toEqual([
			`${"a".repeat(10)}.`,
			"b".repeat(10),
		]);
	});

	test("splits after a space when no punctuation is in range", () => {
		expect(splitPhonemesForTokenLimit("aaa aaa aaa", 7)).toEqual([
			"aaa ",
			"aaa aaa",
		]);
	});

	test("hard-cuts when neither punctuation nor space is in range", () => {
		expect(splitPhonemesForTokenLimit("a".repeat(20), 8)).toEqual([
			"a".repeat(8),
			"a".repeat(8),
			"a".repeat(4),
		]);
	});

	test("pieces are lossless and each within the limit", () => {
		const s =
			"ɪf juː kˈæn kˈiːp jɔːɹ hˈɛd wˌɛn ˈɔːl ɐbˈaʊt juː, ɑːɹ lˈuːzɪŋ ðˈɛɹz ænd blˈeɪmɪŋ ɪt ˌɒn jˈuː; ".repeat(
				12,
			);
		const pieces = splitPhonemesForTokenLimit(s, 500);
		expect(pieces.join("")).toBe(s);
		expect(pieces.length).toBeGreaterThan(1);
		for (const p of pieces) {
			expect(p.length).toBeGreaterThan(0);
			expect(p.length).toBeLessThanOrEqual(500);
		}
	});
});
