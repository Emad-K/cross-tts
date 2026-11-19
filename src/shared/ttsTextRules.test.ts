import { describe, expect, test } from "bun:test";
import {
	type RegexReplaceRule,
	applyTtsTextRules,
	defaultTtsTextRulesState,
	setSlowTtsRuleHandler,
} from "./ttsTextRules";

describe("slow custom rule guard", () => {
	test("reports a custom rule slower than 50 ms, only on its first run", () => {
		const slow: RegexReplaceRule = {
			id: "slow-1",
			kind: "regex",
			label: "backtracker",
			pattern: "(a+)+b",
			replacement: "",
			enabled: true,
			caseSensitive: false,
		};
		const fast: RegexReplaceRule = { ...slow, id: "fast-1", pattern: "x" };
		const state = { regexRules: [fast, slow], pronunciationRules: [] };
		const reported: string[] = [];
		setSlowTtsRuleHandler((rule) => reported.push(rule.id));
		try {
			const text = `${"a".repeat(25)}!`;
			applyTtsTextRules(text, state);
			expect(reported).toEqual(["slow-1"]);
			applyTtsTextRules("short", state);
			expect(reported).toEqual(["slow-1"]);
		} finally {
			setSlowTtsRuleHandler(null);
		}
	});
});

describe("applyTtsTextRules", () => {
	test("default rules remove CJK, equals runs, URLs, and chapter lines", () => {
		const text =
			"Chapter 1: Title\n==========\nSee https://example.com/path for info.\n中文";
		const out = applyTtsTextRules(text, defaultTtsTextRulesState());
		expect(out).not.toContain("中文");
		expect(out).not.toContain("==========");
		expect(out).not.toContain("https://example.com");
		expect(out).not.toContain("Chapter 1");
		expect(out).toContain("See");
	});

	test("default pronunciation includes qi", () => {
		const state = defaultTtsTextRulesState();
		const qi = state.pronunciationRules.find((r) => r.id === "builtin-pron-qi");
		expect(qi?.word).toBe("qi");
		expect(qi?.phonetic).toBe("tʃiː");
		expect(qi?.builtIn).toBe(true);
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
