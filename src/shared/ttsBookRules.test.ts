import { describe, expect, test } from "bun:test";
import {
	applyImportedUserRules,
	buildTtsRulesExport,
	parseTtsRulesExport,
} from "./ttsRulesExchange";
import {
	type PronunciationRule,
	type RegexReplaceRule,
	applyTtsTextRules,
	coerceTtsTextRulesState,
	effectiveTtsRules,
	ttsTextRulesSignature,
} from "./ttsTextRules";

const regex = (id: string, pattern: string, replacement: string, book?: string) =>
	({
		id,
		kind: "regex",
		label: id,
		pattern,
		replacement,
		enabled: true,
		caseSensitive: false,
		...(book ? { book } : {}),
	}) satisfies RegexReplaceRule;

const pron = (id: string, word: string, book?: string) =>
	({
		id,
		kind: "pronunciation",
		word,
		phonetic: id,
		caseSensitive: false,
		enabled: true,
		...(book ? { book } : {}),
	}) satisfies PronunciationRule;

const state = {
	// The book rule is stored first on purpose: order of storage must not matter.
	regexRules: [
		regex("book-a", "cat", "lion", "/a.epub"),
		regex("global", "dog", "cat"),
		regex("book-b", "dog", "wolf", "/b.epub"),
	],
	pronunciationRules: [
		pron("global-qi", "qi"),
		pron("a-qi", "qi", "/a.epub"),
		pron("b-li", "li", "/b.epub"),
	],
};

describe("effectiveTtsRules", () => {
	test("with no book open only all-books rules apply", () => {
		const rules = effectiveTtsRules(state, null);
		expect(rules.regexRules.map((r) => r.id)).toEqual(["global"]);
		expect(rules.pronunciationRules.map((r) => r.id)).toEqual(["global-qi"]);
	});

	test("a book's regex rules run before the all-books ones", () => {
		const rules = effectiveTtsRules(state, "/a.epub");
		expect(rules.regexRules.map((r) => r.id)).toEqual(["book-a", "global"]);
		expect(applyTtsTextRules("a dog", effectiveTtsRules(state, "/c.txt"))).toBe(
			"a cat",
		);
	});

	test("a book's respelling beats the all-books one for the same word", () => {
		const respell = (id: string, replacement: string, book?: string) => ({
			...state.regexRules[0]!,
			id,
			pattern: "\\bSiobhan\\b",
			replacement,
			book,
		});
		const both = {
			regexRules: [respell("all", "shiv-awn"), respell("own", "see-oh-ban", "/a.epub")],
			pronunciationRules: [],
		};
		const say = (book: string) =>
			applyTtsTextRules("Siobhan smiled.", effectiveTtsRules(both, book));
		expect(say("/a.epub")).toBe("see-oh-ban smiled.");
		expect(say("/b.epub")).toBe("shiv-awn smiled.");
	});

	test("a book's pronunciation comes first, so it overrides the general one", () => {
		expect(
			effectiveTtsRules(state, "/a.epub").pronunciationRules.map((r) => r.id),
		).toEqual(["a-qi", "global-qi"]);
	});

	test("the signature changes with the book only when its rules differ", () => {
		const sig = (book: string | null) =>
			ttsTextRulesSignature(effectiveTtsRules(state, book));
		expect(sig("/a.epub")).not.toBe(sig("/b.epub"));
		expect(sig("/c.txt")).toBe(sig(null));
	});
});

test("coerceTtsTextRulesState keeps a rule's book", () => {
	const out = coerceTtsTextRulesState(JSON.parse(JSON.stringify(state)));
	expect(out.regexRules.find((r) => r.id === "book-a")?.book).toBe("/a.epub");
	expect(out.regexRules.find((r) => r.id === "global")).not.toHaveProperty("book");
	expect(out.pronunciationRules.find((r) => r.id === "a-qi")?.book).toBe(
		"/a.epub",
	);
});

test("export and import keep a rule's book", () => {
	const file = buildTtsRulesExport(state);
	const parsed = parseTtsRulesExport(JSON.stringify(file));
	if (!parsed.ok) throw new Error(parsed.error);
	expect(parsed.data.regexRules.map((r) => r.book)).toEqual([
		"/a.epub",
		undefined,
		"/b.epub",
	]);
	let n = 0;
	const next = applyImportedUserRules(
		{ regexRules: [], pronunciationRules: [] },
		parsed.data,
		"replace",
		(prefix) => `${prefix}-${n++}`,
	);
	expect(next.regexRules.map((r) => r.book)).toEqual([
		"/a.epub",
		undefined,
		"/b.epub",
	]);
	expect(next.pronunciationRules.map((r) => r.book)).toEqual([
		undefined,
		"/a.epub",
		"/b.epub",
	]);
});
