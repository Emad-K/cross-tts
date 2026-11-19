import { describe, expect, test } from "bun:test";
import {
	REPEATED_LINES_RULE_ID,
	detectRepeatedLines,
	stripRepeatedLines,
} from "./ttsClutter";
import {
	SKIP_CLUTTER_GROUP,
	applyTtsTextRules,
	coerceTtsTextRulesState,
	defaultTtsTextRulesState,
} from "./ttsTextRules";

/** Speak `text` with only the "Skip clutter" rules, defaults or `enabled` ids. */
function speak(text: string, enabled?: string[]): string {
	const state = defaultTtsTextRulesState();
	state.regexRules = state.regexRules
		.filter((r) => r.group === SKIP_CLUTTER_GROUP)
		.map((r) => (enabled ? { ...r, enabled: enabled.includes(r.id) } : r));
	return applyTtsTextRules(text, state);
}

describe("skip clutter defaults", () => {
	test("safe rules are on, risky ones off", () => {
		const rules = defaultTtsTextRulesState().regexRules.filter(
			(r) => r.group === SKIP_CLUTTER_GROUP,
		);
		expect(rules.filter((r) => r.enabled).map((r) => r.id)).toEqual([
			"builtin-clutter-reference-markers",
			"builtin-clutter-footnote-marks",
			"builtin-clutter-emails",
			"builtin-clutter-www",
		]);
		expect(rules.filter((r) => !r.enabled).map((r) => r.id)).toEqual([
			"builtin-clutter-page-numbers",
			REPEATED_LINES_RULE_ID,
		]);
	});

	test("existing users get the group, and their choices survive", () => {
		const upgraded = coerceTtsTextRulesState({
			regexRules: [
				{ id: "mine", kind: "regex", pattern: "foo", replacement: "bar" },
			],
			pronunciationRules: [],
		});
		const refs = upgraded.regexRules.find(
			(r) => r.id === "builtin-clutter-reference-markers",
		);
		expect(refs?.enabled).toBe(true);
		expect(refs?.group).toBe(SKIP_CLUTTER_GROUP);

		const off = coerceTtsTextRulesState({
			regexRules: upgraded.regexRules.map((r) =>
				r.id === refs!.id ? { ...r, enabled: false } : r,
			),
			pronunciationRules: [],
		});
		expect(off.regexRules.find((r) => r.id === refs!.id)?.enabled).toBe(false);
	});
});

describe("reference markers", () => {
	test("removes numeric citations and the space before them", () => {
		expect(speak("The war ended in 1945 [12].")).toBe("The war ended in 1945.");
		expect(speak("It was disputed.[3] Later")).toBe("It was disputed. Later");
		expect(speak("as shown[3-5] and [1, 2] here")).toBe("as shown and here");
		expect(speak("see [7][8]; also [10–12]")).toBe("see; also");
	});

	test("removes citations inside quotations", () => {
		expect(speak("“It was never proven [4],” she wrote.")).toBe(
			"“It was never proven,” she wrote.",
		);
	});

	test("keeps bracketed years", () => {
		expect(speak("First published [1999] in Paris")).toBe(
			"First published [1999] in Paris",
		);
	});

	test("keeps single-letter indexing (code and maths)", () => {
		expect(speak("so a[1] is larger than x[12]")).toBe(
			"so a[1] is larger than x[12]",
		);
	});

	test("keeps brackets that aren't just numbers", () => {
		expect(speak("he [sic] said [see p. 4]")).toBe("he [sic] said [see p. 4]");
	});
});

describe("footnote marks", () => {
	test("removes superscript digits after a word or punctuation", () => {
		expect(speak("as Smith argued¹² and others agreed.³")).toBe(
			"as Smith argued and others agreed.",
		);
		expect(speak("“Never,” he said.”⁴ Then")).toBe("“Never,” he said.” Then");
	});

	test("keeps exponents", () => {
		const maths = "x² + y² over 25 m² and 3 km³, or 10² and E = mc²";
		expect(speak(maths)).toBe(maths);
	});

	test("removes daggers and asterisks glued to a word", () => {
		expect(speak("the treaty* was signed† in May‡.")).toBe(
			"the treaty was signed in May.",
		);
		expect(speak("a rare case.** See below")).toBe("a rare case. See below");
	});

	test("keeps multiplication and markdown emphasis", () => {
		for (const text of ["2 * 3 = 6", "a*b", "this is **bold** and *soft* text"]) {
			expect(speak(text)).toBe(text);
		}
	});
});

describe("addresses", () => {
	test("skips email addresses", () => {
		expect(speak("Write to jane.doe+books@example.co.uk today.")).toBe(
			"Write to today.",
		);
		expect(speak("Contact <info@example.com> for details")).toBe(
			"Contact for details",
		);
		expect(speak("Ask sam@example.com.")).toBe("Ask.");
	});

	test("keeps an at sign that isn't an address", () => {
		expect(speak("meet @ noon, 5 apples @ 2 each")).toBe(
			"meet @ noon, 5 apples @ 2 each",
		);
	});

	test("skips www addresses but keeps the sentence's punctuation", () => {
		expect(speak("Visit www.example.com/books?id=3.")).toBe("Visit.");
		expect(speak("(see www.example.org) for more")).toBe("(see) for more");
		expect(speak("Try www.example.org today")).toBe("Try today");
		// Left whole for the "Remove URLs" rule.
		expect(speak("at https://www.example.org/a now")).toBe(
			"at https://www.example.org/a now",
		);
	});
});

describe("page-number lines (off by default)", () => {
	const on = ["builtin-clutter-page-numbers"];

	test("left alone unless enabled", () => {
		expect(speak("end of page\n12\nnext page")).toBe("end of page\n12\nnext page");
	});

	test("removes lines that are only a page number", () => {
		expect(speak("end of page\n12\nnext page", on)).toBe("end of page\nnext page");
		expect(speak("Page 12", on)).toBe("");
		expect(speak("- 12 -\nMore text", on)).toBe("More text");
		expect(speak("Text\nPage 3 of 300", on)).toBe("Text");
	});

	test("keeps numbers that are part of a line", () => {
		for (const text of ["He was 12", "12 angry men", "In 1984\nit began"]) {
			expect(speak(text, on)).toBe(text);
		}
	});
});

describe("repeated running headers", () => {
	const page = (n: number) =>
		`The Long Voyage    ${n}\nSome prose for page ${n} goes here, long enough.\nCHAPTER 2: AT SEA`;
	const book = [1, 2, 3, 4, 5].map(page).join("\n");

	test("finds short lines repeated four or more times, ignoring numbers", () => {
		expect([...detectRepeatedLines(book)].sort()).toEqual([
			"chapter #: at sea",
			"the long voyage #",
		]);
	});

	test("needs four repeats", () => {
		expect(detectRepeatedLines([1, 2, 3].map(page).join("\n")).size).toBe(0);
	});

	test("ignores repeated dialogue, bare numbers and long lines", () => {
		const long = "This sentence is far too long to be a running header ".repeat(2);
		const text = ["“Yes.”", "No!", "12", long.trim()]
			.flatMap((l) => [l, l, l, l, l])
			.join("\n");
		expect(detectRepeatedLines(text).size).toBe(0);
	});

	test("strips those lines from a chunk and nothing else", () => {
		const repeated = detectRepeatedLines(book);
		expect(
			stripRepeatedLines("The Long Voyage 7\nSome prose stays.", repeated),
		).toBe("Some prose stays.");
		expect(stripRepeatedLines("The Long Voyage was long.", repeated)).toBe(
			"The Long Voyage was long.",
		);
		expect(stripRepeatedLines("anything", new Set())).toBe("anything");
	});

	test("its toggle rule never changes text by itself", () => {
		expect(speak(book, [REPEATED_LINES_RULE_ID])).toBe(
			applyTtsTextRules(book, { regexRules: [], pronunciationRules: [] }),
		);
	});
});
