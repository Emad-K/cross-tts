import {
	PINYIN_PACK_GROUP,
	PINYIN_PRONUNCIATION_PACK,
} from "./ttsPinyinPack";

export { PINYIN_PACK_GROUP, PINYIN_PRONUNCIATION_PACK };

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
	/** Builtin preset group; grouped rules render under a collapsible section. */
	group?: string;
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
	/** Builtin preset group; grouped rules render under a collapsible section. */
	group?: string;
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

/** Default-off builtin preset group: chapter-end junk in translated webnovels. */
export const WEBNOVEL_BOILERPLATE_GROUP = "Webnovel boilerplate";

/** Short blurbs shown under each builtin preset group header in the panel. */
export const BUILTIN_GROUP_DESCRIPTIONS: Record<string, string> = {
	[WEBNOVEL_BOILERPLATE_GROUP]:
		"Skips common chapter-end junk in translated webnovels (notes, sponsor pleas, Discord/Patreon plugs). Off by default — enable the presets you want.",
	[PINYIN_PACK_GROUP]:
		"Experimental — enable the terms you want. IPA is best-effort and still needs listening QA.",
};

/**
 * Curated skip rules for translated webnovel / cultivation-novel boilerplate.
 * Each rule deletes the whole matching line; all are case-insensitive and
 * shipped DISABLED (toggle individually in the rules panel).
 */
const WEBNOVEL_BOILERPLATE_PRESETS: RegexReplaceRule[] = (
	[
		{
			id: "builtin-skip-author-note-lines",
			label: "Skip “Author's note: …” / “Translator's note: …” lines",
			// Whole line starting with author's/translator's/editor's note(s).
			pattern:
				"(?:^|\\n)[ \\t]*(?:author|translator|editor|proofreader)(?:['’]?s)?[ \\t]*notes?[ \\t]*[:\\-–—][^\\n\\r]*",
		},
		{
			id: "builtin-skip-note-tag-lines",
			label: "Skip “A/N:”, “T/N:”, “TL:”, “ED:”, “PR:” lines",
			// Tag must open the line and be followed by a colon ("A/N" and
			// "T/N" require the slash so prose words "an"/"tn" never match).
			pattern: "(?:^|\\n)[ \\t]*(?:a/n|t/n|tl|ed|pr)[ \\t]*:[^\\n\\r]*",
		},
		{
			id: "builtin-skip-sponsored-chapter-lines",
			label: "Skip “Sponsored chapter(s)” lines",
			pattern: "(?:^|\\n)[^\\n\\r]*\\bsponsored[ \\t]+chapters?\\b[^\\n\\r]*",
		},
		{
			id: "builtin-skip-brought-to-you-lines",
			label: "Skip “Chapter brought to you by …” lines",
			pattern:
				"(?:^|\\n)[^\\n\\r]*\\bchapters?[ \\t]+(?:brought[ \\t]+to[ \\t]+you[ \\t]+by|sponsored[ \\t]+by)\\b[^\\n\\r]*",
		},
		{
			id: "builtin-skip-patreon-lines",
			label: "Skip Patreon / Ko-fi support lines",
			// "ko-fi" requires the hyphen so the name "Kofi" never matches.
			pattern:
				"(?:^|\\n)[^\\n\\r]*\\b(?:support[ \\t]+(?:me|us|the[ \\t]+(?:author|translator|team))[ \\t]+on\\b|patreon\\b|ko-fi\\b)[^\\n\\r]*",
		},
		{
			id: "builtin-skip-discord-lines",
			label: "Skip “Join the/our Discord” lines",
			pattern:
				"(?:^|\\n)[^\\n\\r]*\\bjoin[ \\t]+(?:(?:the|our|my)[ \\t]+)?discord\\b[^\\n\\r]*",
		},
		{
			id: "builtin-skip-read-ahead-lines",
			label: "Skip “Read ahead at …” / “Advance chapters …” lines",
			pattern:
				"(?:^|\\n)[^\\n\\r]*\\b(?:read[ \\t]+ahead[ \\t]+(?:at|on)\\b|advance(?:d)?[ \\t]+chapters?\\b)[^\\n\\r]*",
		},
	] as const
).map((preset) => ({
	...preset,
	kind: "regex" as const,
	replacement: "",
	enabled: false,
	caseSensitive: false,
	builtIn: true,
	group: WEBNOVEL_BOILERPLATE_GROUP,
}));

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
			// Default-off "Webnovel boilerplate" preset group (cloned so callers
			// can safely mutate the returned state).
			...WEBNOVEL_BOILERPLATE_PRESETS.map((r) => ({ ...r })),
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
			// Default-off "Pinyin (xianxia/wuxia)" pack (absorbs the old starter
			// CJK pack — ids are stable). IPA is best-effort; enable and
			// fine-tune what you need in the rules editor. Cloned per call.
			...PINYIN_PRONUNCIATION_PACK.map((r) => ({ ...r })),
		],
	};
}

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

	const builtInRegexById = new Map(
		defaults.regexRules.filter((r) => r.builtIn).map((r) => [r.id, r]),
	);
	for (const builtin of defaults.regexRules) {
		if (!regexRules.some((r) => r.id === builtin.id)) {
			regexRules.unshift(builtin);
		}
	}
	for (const r of regexRules) {
		const builtin = builtInRegexById.get(r.id);
		if (builtin) {
			r.builtIn = true;
			if (builtin.group) r.group = builtin.group;
		}
	}

	const builtInPronById = new Map(
		defaults.pronunciationRules
			.filter((r) => r.builtIn)
			.map((r) => [r.id, r]),
	);
	for (const builtin of defaults.pronunciationRules) {
		if (!pronunciationRules.some((r) => r.id === builtin.id)) {
			pronunciationRules.unshift(builtin);
		}
	}
	for (const r of pronunciationRules) {
		const builtin = builtInPronById.get(r.id);
		if (builtin) {
			r.builtIn = true;
			if (builtin.group) r.group = builtin.group;
		}
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
