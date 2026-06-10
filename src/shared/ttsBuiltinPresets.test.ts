import { describe, expect, test } from "bun:test";
import {
	ESSENTIALS_GROUP,
	PINYIN_PACK_GROUP,
	PINYIN_PRONUNCIATION_PACK,
	WEBNOVEL_BOILERPLATE_GROUP,
	applyRegexReplaceRule,
	applyTtsTextRules,
	coerceTtsTextRulesState,
	defaultTtsTextRulesState,
	isValidRegexPattern,
} from "./ttsTextRules";

function webnovelPresets() {
	return defaultTtsTextRulesState().regexRules.filter(
		(r) => r.group === WEBNOVEL_BOILERPLATE_GROUP,
	);
}

describe("webnovel boilerplate presets", () => {
	test("every default regex rule compiles with the engine flags", () => {
		for (const rule of defaultTtsTextRulesState().regexRules) {
			expect(isValidRegexPattern(rule.pattern)).toBe(true);
			expect(() => new RegExp(rule.pattern, "giu")).not.toThrow();
		}
	});

	test("presets are default-off, builtin, case-insensitive deletions", () => {
		const presets = webnovelPresets();
		expect(presets.length).toBeGreaterThanOrEqual(5);
		for (const rule of presets) {
			expect(rule.enabled).toBe(false);
			expect(rule.builtIn).toBe(true);
			expect(rule.caseSensitive).toBe(false);
			expect(rule.replacement).toBe("");
			expect(rule.id.startsWith("builtin-skip-")).toBe(true);
		}
	});

	const junkLines = [
		"A/N: Sorry for the late chapter!",
		"Author's Note: please vote for the story!",
		"Translator's note - see the glossary.",
		"TL: I changed the name spelling.",
		"ED: fixed typos",
		"PR: BlueLotus",
		"Sponsored chapters will resume next week.",
		"This chapter brought to you by the WuxiaFans team.",
		"Support me on Patreon for early access!",
		"Buy me a coffee on ko-fi!",
		"Join our Discord to discuss the novel!",
		"Read ahead at my site.",
		"Get advance chapters on my page.",
	];

	test("enabled presets remove common chapter-end junk lines", () => {
		const state = defaultTtsTextRulesState();
		for (const rule of state.regexRules) {
			if (rule.group === WEBNOVEL_BOILERPLATE_GROUP) rule.enabled = true;
		}
		const story = "Lin Feng drew his sword and stepped into the night.";
		const out = applyTtsTextRules(
			[story, ...junkLines].join("\n"),
			state,
		);
		expect(out).toContain(story);
		expect(out).not.toContain("Patreon");
		expect(out).not.toContain("Discord");
		expect(out).not.toContain("ko-fi");
		expect(out).not.toContain("Sponsored");
		expect(out).not.toContain("brought to you by");
		expect(out).not.toContain("Read ahead");
		expect(out).not.toContain("advance chapters");
		expect(out).not.toContain("A/N");
		expect(out).not.toContain("BlueLotus");
		expect(out).not.toContain("fixed typos");
	});

	const innocentProse = [
		"She read ahead of her classmates and finished the book.",
		"An author should trust the reader to keep up.",
		"The editor of the journal was a quiet man.",
		"He joined the army despite the discord at home.",
		"Kofi poured the tea and smiled at his guests.",
		"They advanced, chapter by chapter, through the ancient ruins.",
		"Support beams held the old mine open.",
		"Pride: that was always his weakness.",
		"Education: none, yet he spoke five languages.",
		"“Author's note,” she said, “is a phrase I despise.”",
		"The patron of the arts sponsored a gallery, not a war.",
	];

	test("no preset matches innocent prose samples", () => {
		for (const preset of webnovelPresets()) {
			const enabled = { ...preset, enabled: true };
			for (const sentence of innocentProse) {
				expect(applyRegexReplaceRule(sentence, enabled)).toBe(sentence);
			}
		}
	});
});

describe("chapter-title heading skip preset", () => {
	function chapterTitleRule() {
		const rule = webnovelPresets().find(
			(r) => r.id === "builtin-skip-chapter-title-lines",
		);
		if (!rule) throw new Error("chapter-title preset missing");
		return { ...rule, enabled: true };
	}

	const headingLines = [
		"A Record of a Mortal's Journey to Immortality - Chapter 2",
		"A Record of a Mortal’s Journey to Immortality – Chapter 2 – The Awakening",
		"Reverend Insanity — chapter 1024",
		"Lord of the Mysteries - CHAPTER 7: Fog",
		"Keyboard Immortal - Chapter 12.5 - Interlude",
		"  My Disciple Died Yet Again - Chapter 33  ",
	];

	test("matches whole title-dash-chapter heading lines", () => {
		const rule = chapterTitleRule();
		for (const line of headingLines) {
			expect(applyRegexReplaceRule(line, rule).trim()).toBe("");
		}
	});

	const proseLines = [
		"In this chapter we learn about qi.",
		"Chapter 2 begins",
		"Chapter 2: The Awakening",
		"My Book - Chapter 2 begins now and the story continues.",
		"He paused - the chapter was over.",
		"She wrote chapter 9 - then deleted it.",
		"It was a long journey to immortality, chapter after chapter.",
	];

	test("never matches prose that merely mentions chapters", () => {
		const rule = chapterTitleRule();
		for (const line of proseLines) {
			expect(applyRegexReplaceRule(line, rule)).toBe(line);
		}
	});

	test("removes only the heading line from multi-line chunk text", () => {
		const state = defaultTtsTextRulesState();
		for (const rule of state.regexRules) {
			if (rule.id === "builtin-skip-chapter-title-lines") rule.enabled = true;
		}
		const story = "Han Li opened his eyes inside the cave.";
		const out = applyTtsTextRules(
			`A Record of a Mortal's Journey to Immortality - Chapter 2\n${story}`,
			state,
		);
		expect(out).toBe(story);
	});
});

describe("essentials group", () => {
	test("all builtin rules belong to a named group", () => {
		const state = defaultTtsTextRulesState();
		for (const rule of [...state.regexRules, ...state.pronunciationRules]) {
			if (rule.builtIn) {
				expect(typeof rule.group).toBe("string");
				expect(rule.group?.length).toBeGreaterThan(0);
			}
		}
		// The original always-on defaults sit in the Essentials group.
		const essentials = state.regexRules.filter(
			(r) => r.group === ESSENTIALS_GROUP,
		);
		expect(essentials.length).toBeGreaterThanOrEqual(5);
		for (const rule of essentials) expect(rule.enabled).toBe(true);
		expect(
			state.pronunciationRules.find((r) => r.id === "builtin-pron-qi")?.group,
		).toBe(ESSENTIALS_GROUP);
	});

	test("coercion re-stamps groups on old saves and keeps user toggles", () => {
		// Simulate a pre-grouping save: no `group` fields, one essential rule
		// disabled by the user and one webnovel preset enabled.
		const saved = defaultTtsTextRulesState();
		const rawRegex = saved.regexRules.map(({ group: _g, ...r }) => ({
			...r,
			enabled:
				r.id === "builtin-urls"
					? false
					: r.id === "builtin-skip-patreon-lines"
						? true
						: r.enabled,
		}));
		const rawPron = saved.pronunciationRules.map(
			({ group: _g, ...r }) => ({ ...r }),
		);
		const out = coerceTtsTextRulesState({
			regexRules: rawRegex,
			pronunciationRules: rawPron,
		});

		const urls = out.regexRules.find((r) => r.id === "builtin-urls");
		expect(urls?.enabled).toBe(false);
		expect(urls?.group).toBe(ESSENTIALS_GROUP);
		const patreon = out.regexRules.find(
			(r) => r.id === "builtin-skip-patreon-lines",
		);
		expect(patreon?.enabled).toBe(true);
		expect(patreon?.group).toBe(WEBNOVEL_BOILERPLATE_GROUP);
		const qi = out.pronunciationRules.find(
			(r) => r.id === "builtin-pron-qi",
		);
		expect(qi?.group).toBe(ESSENTIALS_GROUP);
		expect(qi?.builtIn).toBe(true);
	});
});

describe("pinyin pronunciation pack", () => {
	test("pack is curated, default-off, and grouped", () => {
		expect(PINYIN_PRONUNCIATION_PACK.length).toBeGreaterThanOrEqual(60);
		expect(PINYIN_PRONUNCIATION_PACK.length).toBeLessThanOrEqual(100);
		for (const rule of PINYIN_PRONUNCIATION_PACK) {
			expect(rule.enabled).toBe(false);
			expect(rule.builtIn).toBe(true);
			expect(rule.caseSensitive).toBe(false);
			expect(rule.group).toBe(PINYIN_PACK_GROUP);
		}
	});

	test("entries are single whole words with unique ids", () => {
		const ids = new Set<string>();
		const words = new Set<string>();
		for (const rule of PINYIN_PRONUNCIATION_PACK) {
			// Single lowercase token → the engine's \bword\b match is whole-word safe.
			expect(rule.word).toMatch(/^[a-z]+$/);
			expect(ids.has(rule.id)).toBe(false);
			expect(words.has(rule.word)).toBe(false);
			ids.add(rule.id);
			words.add(rule.word);
		}
		// `qi` is its own (default-on) builtin and must not be duplicated here.
		expect(words.has("qi")).toBe(false);
		expect(ids.has("builtin-pron-qi")).toBe(false);
	});

	test("IPA survives kokoro post-processing and uses known phonemes", () => {
		// kokoroPostProcessPhonemes rewrites `r` → `ɹ` and `x` → `k` over the
		// whole phoneme stream, so raw `r`/`x` in custom IPA would corrupt it.
		const allowed = new Set(
			"abdefhijklmnopstuvwzɑɒɔɛɜɪʊʌəæŋʃʒɹɡː ˈˌ",
		);
		for (const rule of PINYIN_PRONUNCIATION_PACK) {
			expect(rule.phonetic.trim().length).toBeGreaterThan(0);
			expect(rule.phonetic).not.toMatch(/[xr]/);
			for (const ch of rule.phonetic) {
				if (!allowed.has(ch)) {
					throw new Error(
						`Unexpected phoneme char "${ch}" in ${rule.word} → ${rule.phonetic}`,
					);
				}
			}
		}
	});

	// English homographs the pack must never override (see the skip list in
	// ttsPinyinPack.ts) plus a slice of very common English words.
	const englishDenylist = new Set([
		// Documented skipped homographs / loanwords.
		"yin", "yang", "tao", "chi", "zen", "dan", "li", "long", "gong",
		"wang", "song", "ming", "tang", "han", "sun", "ai", "an", "mei",
		"ye", "jun", "chen", "yu", "wu", "xi", "hu", "kung",
		// Common English words that look like pinyin syllables.
		"the", "be", "to", "of", "and", "a", "in", "that", "have", "it",
		"for", "not", "on", "with", "he", "as", "you", "do", "at", "this",
		"but", "his", "by", "from", "they", "we", "say", "her", "she", "or",
		"will", "my", "one", "all", "would", "there", "their", "what", "so",
		"up", "out", "if", "about", "who", "get", "which", "go", "me",
		"when", "make", "can", "like", "time", "no", "just", "him", "know",
		"take", "people", "into", "year", "your", "good", "some", "could",
		"them", "see", "other", "than", "then", "now", "look", "only",
		"come", "its", "over", "think", "also", "back", "after", "use",
		"two", "how", "our", "work", "first", "well", "way", "even", "new",
		"want", "because", "any", "these", "give", "day", "most", "us",
		"man", "men", "can", "ban", "bang", "bin", "din", "ding", "fan",
		"fang", "gang", "hang", "king", "lang", "pan", "pang", "ran",
		"rang", "sang", "sin", "son", "ton", "tan", "ting", "wan", "win",
		"won", "den", "pen", "ten", "zing", "sheng",
	]);

	test("no pack word collides with the English common-word denylist", () => {
		for (const rule of PINYIN_PRONUNCIATION_PACK) {
			if (englishDenylist.has(rule.word)) {
				throw new Error(
					`Pack word "${rule.word}" is a common English word/homograph`,
				);
			}
		}
	});
});
