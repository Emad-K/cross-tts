import { describe, expect, test } from "bun:test";
import { applyTtsTextRules, defaultTtsTextRulesState } from "./ttsTextRules";

function withDefaults(text: string): string {
	return applyTtsTextRules(text, defaultTtsTextRulesState());
}

describe("builtin chapter line rule", () => {
	test("removes common chapter heading lines", () => {
		expect(
			withDefaults("Chapter 1: Spirit Awakening\n\nMartial arts."),
		).toBe("Martial arts.");
		expect(withDefaults("chapter 1 - foo\n\nbar")).toBe("bar");
		expect(withDefaults("CHAPTER 1 : x\n\ny")).toBe("y");
		expect(withDefaults("(Chapter 2: Bar)\n\nz")).toBe("z");
		expect(withDefaults("Ch. 42: Answer\n\nbody")).toBe("body");
		expect(withDefaults("Part 3 - Intro\n\nbody")).toBe("body");
		expect(withDefaults("Chapter 0001-0100\n\nBody text.")).toBe(
			"Body text.",
		);
	});

	test("does not remove inline chapter mentions", () => {
		const out = withDefaults("Keep reading Chapter 1 inline.\n\nNext.");
		expect(out).toContain("Chapter 1");
		expect(out).toContain("Next.");
	});
});
