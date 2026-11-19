import { expect, test } from "bun:test";
import { applyRegexReplaceRule } from "@shared/ttsTextRules";
import { respellRule } from "./respellRule";

const apply = (text: string, word: string, sayAs: string) =>
	applyRegexReplaceRule(text, { id: "r", kind: "regex", ...respellRule(word, sayAs) });

test("replaces the whole word in any case, not parts of longer words", () => {
	expect(apply("Siobhan met siobhan. Siobhans left.", "Siobhan", "Shiv-awn")).toBe(
		"Shiv-awn met Shiv-awn. Siobhans left.",
	);
});

test("handles accents, punctuation in the word and $ in the respelling", () => {
	expect(apply("Zoë's café. Zoëtrope.", "Zoë", "Zoh-ee")).toBe("Zoh-ee's café. Zoëtrope.");
	expect(apply("Use C++ now", "C++", "see plus plus")).toBe("Use see plus plus now");
	expect(apply("pay USD", "USD", "$ dollars")).toBe("pay $ dollars");
});
