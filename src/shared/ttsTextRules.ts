/** Regex find/replace applied to chunk text before Kokoro synthesis. */
export type RegexReplaceRule = {
	id: string;
	kind: "regex";
	label: string;
	pattern: string;
	replacement: string;
	enabled: boolean;
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
};

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
				builtIn: true,
			},
			{
				id: "builtin-equals",
				kind: "regex",
				label: "Remove ==== style separators",
				pattern: "[=]{2,}",
				replacement: "",
				enabled: true,
				builtIn: true,
			},
			{
				id: "builtin-urls",
				kind: "regex",
				label: "Remove URLs",
				pattern: "https?:\\/\\/\\S+",
				replacement: "",
				enabled: true,
				builtIn: true,
			},
		],
		pronunciationRules: [],
	};
}

export function escapeRegexLiteral(word: string): string {
	return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collapse runs of whitespace after removals. */
export function normalizeTtsWhitespace(text: string): string {
	return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
}

export function applyRegexReplaceRule(
	text: string,
	rule: RegexReplaceRule,
): string {
	if (!rule.enabled || !rule.pattern.trim()) return text;
	let re: RegExp;
	try {
		re = new RegExp(rule.pattern, "gu");
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
			});
		}
	}

	const builtInIds = new Set(
		defaults.regexRules.filter((r) => r.builtIn).map((r) => r.id),
	);
	for (const builtin of defaults.regexRules) {
		if (!regexRules.some((r) => r.id === builtin.id)) {
			regexRules.unshift(builtin);
		}
	}
	for (const r of regexRules) {
		if (builtInIds.has(r.id)) r.builtIn = true;
	}

	return {
		regexRules:
			regexRules.length > 0 ? regexRules : defaults.regexRules,
		pronunciationRules,
	};
}

export function ttsTextRulesSignature(state: TtsTextRulesState): string {
	return JSON.stringify(state);
}
