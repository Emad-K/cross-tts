/** Regex find/replace applied to chunk text before Kokoro synthesis. */
export type RegexReplaceRule = {
	id: string;
	kind: "regex";
	label: string;
	pattern: string;
	replacement: string;
	enabled: boolean;
	caseSensitive: boolean;
	/** Built-in rules cannot be deleted (pattern may still be edited). */
	builtIn?: boolean;
};

/** Maps a word to custom IPA phonemes (injected at kokoro-js phonemize time). */
export type PronunciationRule = {
	id: string;
	kind: "pronunciation";
	word: string;
	phonetic: string;
	caseSensitive: boolean;
	enabled: boolean;
	/** Built-in rules cannot be deleted from the UI. */
	builtIn?: boolean;
};

/** Case-insensitive line-start chapter / part / volume headings (EPUB styles). */
const BUILTIN_CHAPTER_HEADING = String.raw`(?:chapter|chapters?|ch\.?|parts?|vol(?:umes?)?\.?|books?)[ \t]*(?:#|no\.?[ \t]*)?(?:\d{1,5}(?:[\-–—]\d{1,5})?|[ivxlcdm]{1,8})(?:(?:[ \t]*:[ \t]*|[ \t]*[\-–—][ \t]*|[ \t]+)[^\n\r]*)?`;

/** Whole-line match: `Chapter 1: Title` or `(Chapter 1: Title)`. */
export const BUILTIN_CHAPTER_LINE_PATTERN = String.raw`(?:^|\n)[ \t]*(?:\(\s*` +
	BUILTIN_CHAPTER_HEADING +
	String.raw`[ \t]*\)|` +
	BUILTIN_CHAPTER_HEADING +
	`)`;

export type TtsTextRule = RegexReplaceRule | PronunciationRule;

export type TtsTextRulesState = {
	regexRules: RegexReplaceRule[];
	pronunciationRules: PronunciationRule[];
};

export function defaultTtsTextRulesState(): TtsTextRulesState {
	return {
		regexRules: [
			{
				id: "builtin-cjk",
				kind: "regex",
				label: "Remove Chinese, Japanese, and Korean characters",
				pattern:
					"[\\u3000-\\u303f\\u3040-\\u309f\\u30a0-\\u30ff\\u4e00-\\u9fff\\uac00-\\ud7af]+",
				replacement: " ",
				enabled: true,
				caseSensitive: false,
				builtIn: true,
			},
			{
				id: "builtin-separators",
				kind: "regex",
				label: "Remove separator lines (e.g. ....., =====, *****)",
				pattern: "(?:\\s+|^)[.=\\*\\-_]{2,}(?=\\s|$)",
				replacement: "",
				enabled: true,
				caseSensitive: false,
				builtIn: true,
			},
			{
				id: "builtin-urls",
				kind: "regex",
				label: "Remove URLs",
				pattern: "https?:\\/\\/\\S+",
				replacement: "",
				enabled: true,
				caseSensitive: false,
				builtIn: true,
			},
			{
				id: "builtin-chapter-lines",
				kind: "regex",
				label:
					"Remove chapter headings (Chapter 1: …, Ch. 2 - …, Part III, etc.)",
				pattern: BUILTIN_CHAPTER_LINE_PATTERN,
				replacement: "",
				enabled: true,
				caseSensitive: false,
				builtIn: true,
			},
			{
				id: "builtin-translator-editor-lines",
				kind: "regex",
				label: "Remove lines starting with Translator: or Editor:",
				// Whole line whose first word is translator/editor + colon.
				pattern: "(?:^|\\n)[ \\t]*(?:translator|editor)[ \\t]*:[^\\n\\r]*",
				replacement: "",
				enabled: true,
				caseSensitive: false,
				builtIn: true,
			},
			{
				// Must run before the inline note rule below so the whole
				// "(...)" is removed instead of leaving empty parens.
				id: "builtin-tl-note-parenthetical",
				kind: "regex",
				label: "Remove parenthetical translator notes — (TN: …), (Translator Note: …)",
				pattern:
					"\\(\\s*(?:translator(?:['’]?s)?[ \\t]*note|t/?n)\\b[^)]*\\)",
				replacement: "",
				enabled: true,
				caseSensitive: false,
				builtIn: true,
			},
			{
				id: "builtin-tl-note-inline",
				kind: "regex",
				label:
					"Remove inline translator notes — TN:, Translator Note:, translatorNote: (to end of line)",
				pattern:
					"\\b(?:translator[ \\t]*note|t/?n)[ \\t]*:[^\\n\\r]*",
				replacement: "",
				enabled: true,
				caseSensitive: false,
				builtIn: true,
			},
		],
		pronunciationRules: [
			{
				id: "builtin-pron-qi",
				kind: "pronunciation",
				word: "qi",
				phonetic: "tʃiː",
				caseSensitive: false,
				enabled: true,
				builtIn: true,
			},
			// Starter pinyin pack for Chinese web novels. Shipped DISABLED — the
			// IPA is best-effort and some words collide with English homographs
			// (dan, li). Enable and fine-tune what you need in the rules editor.
			...CJK_PRONUNCIATION_PACK,
		],
	};
}

/** Common cultivation-novel terms → best-effort IPA. Off by default. */
const CJK_PRONUNCIATION_PACK: PronunciationRule[] = (
	[
		["dao", "daʊ"],
		["jin", "dʒɪn"],
		["dantian", "dɑːnˈtjɛn"],
		["qigong", "tʃiːˈɡɒŋ"],
		["jianghu", "dʒjɑːŋˈhuː"],
		["wuxia", "wuːˈʃjɑː"],
		["xianxia", "ʃjɛnˈʃjɑː"],
		["shifu", "ʃiːˈfuː"],
		["gongzi", "ɡʊŋˈziː"],
		["senpai", "sɛnˈpaɪ"],
	] as const
).map(([word, phonetic]) => ({
	id: `builtin-pron-${word}`,
	kind: "pronunciation" as const,
	word,
	phonetic,
	caseSensitive: false,
	enabled: false,
	builtIn: true,
}));

export function escapeRegexLiteral(word: string): string {
	return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collapse runs of whitespace after removals. */
export function normalizeTtsWhitespace(text: string): string {
	return text
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function applyRegexReplaceRule(
	text: string,
	rule: RegexReplaceRule,
): string {
	if (!rule.enabled || !rule.pattern.trim()) return text;
	let re: RegExp;
	try {
		re = new RegExp(rule.pattern, rule.caseSensitive ? "gu" : "giu");
	} catch {
		return text;
	}
	return text.replace(re, rule.replacement);
}

/**
 * Transform chunk text for Kokoro without changing on-screen highlights.
 * Regex cleanup only; pronunciation is applied in {@link phonemizeForKokoro}.
 */
export function applyTtsTextRules(
	text: string,
	state: TtsTextRulesState,
): string {
	let out = text;
	for (const rule of state.regexRules) {
		out = applyRegexReplaceRule(out, rule);
	}
	return normalizeTtsWhitespace(out);
}

export function isValidRegexPattern(pattern: string): boolean {
	if (!pattern.trim()) return false;
	try {
		void new RegExp(pattern, "u");
		return true;
	} catch {
		return false;
	}
}

export function coerceTtsTextRulesState(raw: unknown): TtsTextRulesState {
	const defaults = defaultTtsTextRulesState();
	if (!raw || typeof raw !== "object") return defaults;
	const o = raw as Record<string, unknown>;

	const regexRules: RegexReplaceRule[] = [];
	if (Array.isArray(o.regexRules)) {
		for (const item of o.regexRules) {
			if (!item || typeof item !== "object") continue;
			const r = item as Record<string, unknown>;
			if (r.kind === "pronunciation") continue;
			const id = typeof r.id === "string" ? r.id : "";
			const pattern = typeof r.pattern === "string" ? r.pattern : "";
			if (!id || !pattern) continue;
			regexRules.push({
				id,
				kind: "regex",
				label:
					typeof r.label === "string" && r.label.length > 0
						? r.label
						: pattern,
				pattern,
				replacement:
					typeof r.replacement === "string" ? r.replacement : "",
				enabled: r.enabled !== false,
				caseSensitive: r.caseSensitive === true,
				builtIn: r.builtIn === true,
			});
		}
	}

	const pronunciationRules: PronunciationRule[] = [];
	if (Array.isArray(o.pronunciationRules)) {
		for (const item of o.pronunciationRules) {
			if (!item || typeof item !== "object") continue;
			const r = item as Record<string, unknown>;
			if (r.kind !== "pronunciation") continue;
			const id = typeof r.id === "string" ? r.id : "";
			const word = typeof r.word === "string" ? r.word : "";
			const phonetic = typeof r.phonetic === "string" ? r.phonetic : "";
			if (!id || !word || !phonetic) continue;
			pronunciationRules.push({
				id,
				kind: "pronunciation",
				word,
				phonetic,
				caseSensitive: r.caseSensitive === true,
				enabled: r.enabled !== false,
				builtIn: r.builtIn === true,
			});
		}
	}

	const builtInRegexIds = new Set(
		defaults.regexRules.filter((r) => r.builtIn).map((r) => r.id),
	);
	for (const builtin of defaults.regexRules) {
		if (!regexRules.some((r) => r.id === builtin.id)) {
			regexRules.unshift(builtin);
		}
	}
	for (const r of regexRules) {
		if (builtInRegexIds.has(r.id)) r.builtIn = true;
	}

	const builtInPronIds = new Set(
		defaults.pronunciationRules
			.filter((r) => r.builtIn)
			.map((r) => r.id),
	);
	for (const builtin of defaults.pronunciationRules) {
		if (!pronunciationRules.some((r) => r.id === builtin.id)) {
			pronunciationRules.unshift(builtin);
		}
	}
	for (const r of pronunciationRules) {
		if (builtInPronIds.has(r.id)) r.builtIn = true;
	}

	return {
		regexRules:
			regexRules.length > 0 ? regexRules : defaults.regexRules,
		pronunciationRules:
			pronunciationRules.length > 0
				? pronunciationRules
				: defaults.pronunciationRules,
	};
}

export function ttsTextRulesSignature(state: TtsTextRulesState): string {
	return JSON.stringify(state);
}
