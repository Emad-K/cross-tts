import { describe, expect, test } from "bun:test";
import { applyTtsTextRules, defaultTtsTextRulesState } from "./ttsTextRules";

describe("applyTtsTextRules", () => {
	test("default rules remove CJK, equals runs, and URLs", () => {
		const text =
			"Chapter 中文\n==========\nSee https://example.com/path for info.";
		const out = applyTtsTextRules(text, defaultTtsTextRulesState());
		expect(out).not.toContain("中文");
		expect(out).not.toContain("==========");
		expect(out).not.toContain("https://example.com");
		expect(out).toContain("Chapter");
		expect(out).toContain("See");
	});

	test("does not embed markdown pronunciation markup", () => {
		const state = defaultTtsTextRulesState();
		state.pronunciationRules.push({
			id: "la",
			kind: "pronunciation",
			word: "Los Angeles",
			phonetic: "lɔs ˈænd͡ʒɛləs",
			caseSensitive: false,
			enabled: true,
		});
		const out = applyTtsTextRules(
			"In Los Angeles there are stars.",
			state,
		);
		expect(out).toBe("In Los Angeles there are stars.");
		expect(out).not.toContain("[Los Angeles]");
	});
});
