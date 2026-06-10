/**
 * Pure helpers for the reader's "Look up" feature: selection → lookup word,
 * context-menu labels, and parsing of https://dictionaryapi.dev responses.
 */

/** One pronunciation variant of a dictionary entry. */
export type DictionaryPhonetic = {
	/** IPA transcription (e.g. "/həˈləʊ/"), or null when only audio exists. */
	text: string | null;
	/** Absolute https URL of a pronunciation recording, or null. */
	audioUrl: string | null;
};

export type DictionaryDefinition = {
	definition: string;
	example: string | null;
};

export type DictionaryMeaning = {
	partOfSpeech: string;
	definitions: DictionaryDefinition[];
};

/** A parsed dictionaryapi.dev entry (one per etymology). */
export type DictionaryEntry = {
	word: string;
	phonetics: DictionaryPhonetic[];
	meanings: DictionaryMeaning[];
};

/** Keep dictionary cards short: only the first few definitions per meaning. */
export const MAX_DEFINITIONS_PER_MEANING = 3;

/** Longest context-menu quote, e.g. `Find "the quick brown fox…"`. */
export const MENU_LABEL_MAX_CHARS = 24;

const DICTIONARY_API_BASE =
	"https://api.dictionaryapi.dev/api/v2/entries/en/";

/** Free Dictionary API endpoint for an English word (no API key needed). */
export function dictionaryApiUrl(word: string): string {
	return `${DICTIONARY_API_BASE}${encodeURIComponent(word)}`;
}

/** Wiktionary page for a word (the "More on Wiktionary" link target). */
export function wiktionaryUrl(word: string): string {
	return `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;
}

/** Collapse all whitespace runs (incl. newlines) to single spaces and trim. */
export function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Word to look up from a text selection: the first whitespace-separated token,
 * stripped of surrounding punctuation/quotes. Internal apostrophes and hyphens
 * survive ("don't", "mother-in-law"). Returns null when the selection has no
 * letters to look up.
 */
export function extractLookupWord(
	selection: string | null | undefined,
): string | null {
	if (!selection) return null;
	const token = collapseWhitespace(selection).split(" ")[0] ?? "";
	// Trim leading/trailing characters that aren't letters or digits.
	const core = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
	if (!/\p{L}/u.test(core)) return null;
	if (core.length > 64) return null;
	return core;
}

/** True when the selection is exactly one word (after trimming punctuation). */
export function isSingleWordSelection(
	selection: string | null | undefined,
): boolean {
	if (!selection) return false;
	const parts = collapseWhitespace(selection).split(" ");
	return parts.length === 1 && extractLookupWord(selection) !== null;
}

/**
 * Single-line, ellipsized label text for menu items quoting the selection.
 */
export function truncateMenuLabel(
	text: string,
	maxChars: number = MENU_LABEL_MAX_CHARS,
): string {
	const oneLine = collapseWhitespace(text);
	if (oneLine.length <= maxChars) return oneLine;
	return `${oneLine.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

/** Normalize an audio URL from the API; protocol-relative → https, http/"" → null. */
function normalizeAudioUrl(value: unknown): string | null {
	const raw = nonEmptyString(value);
	if (!raw) return null;
	const url = raw.startsWith("//") ? `https:${raw}` : raw;
	return url.startsWith("https://") ? url : null;
}

function parsePhonetics(value: unknown): DictionaryPhonetic[] {
	if (!Array.isArray(value)) return [];
	const out: DictionaryPhonetic[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const rec = asRecord(item);
		if (!rec) continue;
		const text = nonEmptyString(rec["text"]);
		const audioUrl = normalizeAudioUrl(rec["audio"]);
		if (!text && !audioUrl) continue;
		const key = `${text ?? ""}|${audioUrl ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ text, audioUrl });
	}
	return out;
}

function parseMeanings(value: unknown): DictionaryMeaning[] {
	if (!Array.isArray(value)) return [];
	const out: DictionaryMeaning[] = [];
	for (const item of value) {
		const rec = asRecord(item);
		if (!rec) continue;
		const partOfSpeech = nonEmptyString(rec["partOfSpeech"]) ?? "";
		const rawDefs = Array.isArray(rec["definitions"]) ? rec["definitions"] : [];
		const definitions: DictionaryDefinition[] = [];
		for (const def of rawDefs) {
			if (definitions.length >= MAX_DEFINITIONS_PER_MEANING) break;
			const defRec = asRecord(def);
			const definition = defRec ? nonEmptyString(defRec["definition"]) : null;
			if (!definition) continue;
			definitions.push({
				definition,
				example: defRec ? nonEmptyString(defRec["example"]) : null,
			});
		}
		if (definitions.length === 0) continue;
		out.push({ partOfSpeech, definitions });
	}
	return out;
}

/**
 * Parse a dictionaryapi.dev success payload into {@link DictionaryEntry}s.
 * Tolerates missing/odd fields; returns [] for non-array payloads (e.g. the
 * API's 404 "No Definitions Found" object) and entries without definitions.
 */
export function parseDictionaryResponse(data: unknown): DictionaryEntry[] {
	if (!Array.isArray(data)) return [];
	const out: DictionaryEntry[] = [];
	for (const item of data) {
		const rec = asRecord(item);
		if (!rec) continue;
		const word = nonEmptyString(rec["word"]);
		if (!word) continue;
		const meanings = parseMeanings(rec["meanings"]);
		if (meanings.length === 0) continue;
		out.push({
			word,
			phonetics: parsePhonetics(rec["phonetics"]),
			meanings,
		});
	}
	return out;
}
