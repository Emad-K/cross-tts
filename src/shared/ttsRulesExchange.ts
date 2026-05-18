import {
	type PronunciationRule,
	type RegexReplaceRule,
	type TtsTextRulesState,
	isValidRegexPattern,
} from "./ttsTextRules";

export const TTS_RULES_EXPORT_FORMAT = "cross-tts-tts-rules" as const;
export const TTS_RULES_EXPORT_VERSION = 1;

export type TtsRulesExportRegexRule = {
	label: string;
	pattern: string;
	replacement: string;
	enabled: boolean;
};

export type TtsRulesExportPronunciationRule = {
	word: string;
	phonetic: string;
	caseSensitive: boolean;
	enabled: boolean;
};

export type TtsRulesExportFile = {
	format: typeof TTS_RULES_EXPORT_FORMAT;
	version: typeof TTS_RULES_EXPORT_VERSION;
	exportedAt: string;
	regexRules: TtsRulesExportRegexRule[];
	pronunciationRules: TtsRulesExportPronunciationRule[];
};

export type ParseTtsRulesExportResult =
	| { ok: true; data: TtsRulesExportFile }
	| { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** User-added rules only (excludes built-in defaults). */
export function buildTtsRulesExport(
	state: TtsTextRulesState,
): TtsRulesExportFile {
	return {
		format: TTS_RULES_EXPORT_FORMAT,
		version: TTS_RULES_EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		regexRules: state.regexRules
			.filter((r) => !r.builtIn)
			.map((r) => ({
				label: r.label,
				pattern: r.pattern,
				replacement: r.replacement,
				enabled: r.enabled,
			})),
		pronunciationRules: state.pronunciationRules.map((r) => ({
			word: r.word,
			phonetic: r.phonetic,
			caseSensitive: r.caseSensitive,
			enabled: r.enabled,
		})),
	};
}

export function serializeTtsRulesExport(
	state: TtsTextRulesState,
	pretty = true,
): string {
	const payload = buildTtsRulesExport(state);
	return JSON.stringify(payload, null, pretty ? 2 : 0);
}

function parseRegexExportItem(
	item: unknown,
): TtsRulesExportRegexRule | null {
	if (!isRecord(item)) return null;
	const pattern =
		typeof item.pattern === "string" ? item.pattern.trim() : "";
	if (!pattern || !isValidRegexPattern(pattern)) return null;
	const label =
		typeof item.label === "string" && item.label.trim().length > 0
			? item.label.trim()
			: pattern;
	return {
		label,
		pattern,
		replacement:
			typeof item.replacement === "string" ? item.replacement : "",
		enabled: item.enabled !== false,
	};
}

function parsePronunciationExportItem(
	item: unknown,
): TtsRulesExportPronunciationRule | null {
	if (!isRecord(item)) return null;
	const word = typeof item.word === "string" ? item.word.trim() : "";
	const phonetic =
		typeof item.phonetic === "string" ? item.phonetic.trim() : "";
	if (!word || !phonetic) return null;
	return {
		word,
		phonetic,
		caseSensitive: item.caseSensitive === true,
		enabled: item.enabled !== false,
	};
}

export function parseTtsRulesExport(json: string): ParseTtsRulesExportResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { ok: false, error: "File is not valid JSON." };
	}
	if (!isRecord(parsed)) {
		return { ok: false, error: "Expected a JSON object at the root." };
	}
	if (parsed.format !== TTS_RULES_EXPORT_FORMAT) {
		return {
			ok: false,
			error: `Unrecognized format (expected "${TTS_RULES_EXPORT_FORMAT}").`,
		};
	}
	if (parsed.version !== TTS_RULES_EXPORT_VERSION) {
		return {
			ok: false,
			error: `Unsupported version ${String(parsed.version)} (expected ${TTS_RULES_EXPORT_VERSION}).`,
		};
	}
	if (!Array.isArray(parsed.regexRules)) {
		return { ok: false, error: "Missing or invalid regexRules array." };
	}
	if (!Array.isArray(parsed.pronunciationRules)) {
		return {
			ok: false,
			error: "Missing or invalid pronunciationRules array.",
		};
	}

	const regexRules: TtsRulesExportRegexRule[] = [];
	for (let i = 0; i < parsed.regexRules.length; i++) {
		const rule = parseRegexExportItem(parsed.regexRules[i]);
		if (!rule) {
			return {
				ok: false,
				error: `Invalid regex rule at index ${i} (check pattern and fields).`,
			};
		}
		regexRules.push(rule);
	}

	const pronunciationRules: TtsRulesExportPronunciationRule[] = [];
	for (let i = 0; i < parsed.pronunciationRules.length; i++) {
		const rule = parsePronunciationExportItem(parsed.pronunciationRules[i]);
		if (!rule) {
			return {
				ok: false,
				error: `Invalid pronunciation rule at index ${i}.`,
			};
		}
		pronunciationRules.push(rule);
	}

	return {
		ok: true,
		data: {
			format: TTS_RULES_EXPORT_FORMAT,
			version: TTS_RULES_EXPORT_VERSION,
			exportedAt:
				typeof parsed.exportedAt === "string"
					? parsed.exportedAt
					: new Date().toISOString(),
			regexRules,
			pronunciationRules,
		},
	};
}

export type ImportUserRulesMode = "replace" | "append";

export function applyImportedUserRules(
	current: TtsTextRulesState,
	imported: TtsRulesExportFile,
	mode: ImportUserRulesMode,
	newId: (prefix: string) => string,
): TtsTextRulesState {
	const builtins = current.regexRules.filter((r) => r.builtIn);
	const customRegex =
		mode === "replace"
			? []
			: current.regexRules.filter((r) => !r.builtIn);
	const pronunciation =
		mode === "replace" ? [] : [...current.pronunciationRules];

	const importedRegex: RegexReplaceRule[] = imported.regexRules.map(
		(r) => ({
			id: newId("regex"),
			kind: "regex",
			label: r.label,
			pattern: r.pattern,
			replacement: r.replacement,
			enabled: r.enabled,
			builtIn: false,
		}),
	);

	const importedPron: PronunciationRule[] =
		imported.pronunciationRules.map((r) => ({
			id: newId("pron"),
			kind: "pronunciation",
			word: r.word,
			phonetic: r.phonetic,
			caseSensitive: r.caseSensitive,
			enabled: r.enabled,
		}));

	return {
		regexRules: [...builtins, ...customRegex, ...importedRegex],
		pronunciationRules: [...pronunciation, ...importedPron],
	};
}

export function exportFilenameForDate(date = new Date()): string {
	const iso = date.toISOString().slice(0, 10);
	return `cross-tts-rules-${iso}.json`;
}
