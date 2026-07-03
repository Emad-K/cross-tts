import { phonemize } from "phonemizer";
import type { PronunciationRule } from "@shared/ttsTextRules";
import { escapeRegexLiteral } from "@shared/ttsTextRules";
import type { KokoroVoiceId } from "./kokoroVoices";

/** Kokoro voice prefix: `a` = US English, `b` = British English. */
export type KokoroLangCode = "a" | "b";

const PUNCTUATION_CHARS = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_SPLIT = new RegExp(
	`(\\s*[${PUNCTUATION_CHARS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+\\s*)+`,
	"g",
);

/** Mirrors kokoro-js text normalization before phonemization. */
export function kokoroNormalizeText(text: string): string {
	return text
		.replace(/[‘’]/g, "'")
		.replace(/«/g, "“")
		.replace(/»/g, "”")
		.replace(/[“”]/g, '"')
		.replace(/\(/g, "«")
		.replace(/\)/g, "»")
		.replace(/、/g, ", ")
		.replace(/。/g, ". ")
		.replace(/！/g, "! ")
		.replace(/，/g, ", ")
		.replace(/：/g, ": ")
		.replace(/；/g, "; ")
		.replace(/？/g, "? ")
		.replace(/[^\S \n]/g, " ")
		.replace(/  +/g, " ")
		.replace(/(?<=\n) +(?=\n)/g, "")
		.replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
		.replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
		.replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
		.replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
		.replace(/\betc\.(?! [A-Z])/gi, "etc")
		.replace(/\b(y)eah?\b/gi, "$1e'a")
		.replace(
			/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g,
			normalizeNumbers,
		)
		.replace(/(?<=\d),(?=\d)/g, "")
		.replace(
			/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi,
			normalizeCurrency,
		)
		.replace(/\d*\.\d+/g, normalizeDecimal)
		.replace(/(?<=\d)-(?=\d)/g, " to ")
		.replace(/(?<=\d)S/g, " S")
		.replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
		.replace(/(?<=X')S\b/g, "s")
		.replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-"))
		.replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
		.trim();
}

function normalizeNumbers(e: string): string {
	if (e.includes(".")) return e;
	if (e.includes(":")) {
		const [a, t] = e.split(":").map(Number);
		if (t === 0) return `${a} o'clock`;
		if (t < 10) return `${a} oh ${t}`;
		return `${a} ${t}`;
	}
	const year = Number.parseInt(e.slice(0, 4), 10);
	if (year < 1100 || year % 1000 < 10) return e;
	const head = e.slice(0, 2);
	const tail = Number.parseInt(e.slice(2, 4), 10);
	const suffix = e.endsWith("s") ? "s" : "";
	if (year % 1000 >= 100 && year % 1000 <= 999) {
		if (tail === 0) return `${head} hundred${suffix}`;
		if (tail < 10) return `${head} oh ${tail}${suffix}`;
	}
	return `${head} ${tail}${suffix}`;
}

function normalizeCurrency(e: string): string {
	const unit = e[0] === "$" ? "dollar" : "pound";
	if (Number.isNaN(Number(e.slice(1)))) return `${e.slice(1)} ${unit}s`;
	if (!e.includes(".")) {
		const plural = e.slice(1) === "1" ? "" : "s";
		return `${e.slice(1)} ${unit}${plural}`;
	}
	const [whole, frac] = e.slice(1).split(".");
	const cents = Number.parseInt(frac.padEnd(2, "0"), 10);
	const centWord =
		e[0] === "$"
			? cents === 1
				? "cent"
				: "cents"
			: cents === 1
				? "penny"
				: "pence";
	return `${whole} ${unit}${whole === "1" ? "" : "s"} and ${cents} ${centWord}`;
}

function normalizeDecimal(e: string): string {
	const [a, t] = e.split(".");
	return `${a} point ${t.split("").join(" ")}`;
}

type TextSegment = { literal: boolean; text: string };

function splitPunctuationSegments(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	let pos = 0;
	for (const m of text.matchAll(PUNCTUATION_SPLIT)) {
		const idx = m.index ?? 0;
		if (idx > pos) {
			segments.push({ literal: false, text: text.slice(pos, idx) });
		}
		if (m[0].length > 0) {
			segments.push({ literal: true, text: m[0] });
		}
		pos = idx + m[0].length;
	}
	if (pos < text.length) {
		segments.push({ literal: false, text: text.slice(pos) });
	}
	return segments;
}

function kokoroLangFromVoice(voice: KokoroVoiceId): KokoroLangCode {
	const code = voice.at(0);
	return code === "b" ? "b" : "a";
}

function espeakLang(code: KokoroLangCode): string {
	return code === "a" ? "en-us" : "en";
}

/** Post-processing applied by kokoro-js after eSpeak phonemization. */
export function kokoroPostProcessPhonemes(
	phonemes: string,
	lang: KokoroLangCode,
): string {
	let s = phonemes
		.replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
		.replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
		.replace(/ʲ/g, "j")
		.replace(/r/g, "ɹ")
		.replace(/x/g, "k")
		.replace(/ɬ/g, "l")
		.replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
		.replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
	if (lang === "a") {
		s = s.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
	}
	return s.trim();
}

function formatCustomPhonetic(phonetic: string): string {
	return phonetic.trim().replace(/\s+/g, " ");
}

type PronunciationSpan = { start: number; end: number; phonetic: string };

function collectPronunciationSpans(
	text: string,
	rules: PronunciationRule[],
): PronunciationSpan[] {
	const spans: PronunciationSpan[] = [];
	for (const rule of rules) {
		if (!rule.enabled) continue;
		const word = rule.word.trim();
		const phonetic = rule.phonetic.trim();
		if (!word || !phonetic) continue;
		let re: RegExp;
		try {
			re = new RegExp(
				`\\b${escapeRegexLiteral(word)}\\b`,
				rule.caseSensitive ? "g" : "gi",
			);
		} catch {
			continue;
		}
		for (const m of text.matchAll(re)) {
			if (m.index === undefined) continue;
			spans.push({
				start: m.index,
				end: m.index + m[0].length,
				phonetic,
			});
		}
	}
	spans.sort((a, b) => a.start - b.start || b.end - a.end);
	const merged: PronunciationSpan[] = [];
	for (const span of spans) {
		const last = merged.at(-1);
		if (last && span.start < last.end) continue;
		merged.push(span);
	}
	return merged;
}

async function espeakPhonemize(text: string, lang: KokoroLangCode): Promise<string> {
	const parts = await phonemize(text, espeakLang(lang));
	return parts.join(" ");
}

async function phonemizeSpeakableSlice(
	text: string,
	lang: KokoroLangCode,
	rules: PronunciationRule[],
): Promise<string> {
	if (!text) return "";
	const spans = collectPronunciationSpans(text, rules);
	if (spans.length === 0) return espeakPhonemize(text, lang);

	const chunks: string[] = [];
	let pos = 0;
	for (const span of spans) {
		if (span.start > pos) {
			chunks.push(await espeakPhonemize(text.slice(pos, span.start), lang));
		}
		chunks.push(formatCustomPhonetic(span.phonetic));
		pos = span.end;
	}
	if (pos < text.length) {
		chunks.push(await espeakPhonemize(text.slice(pos), lang));
	}
	return chunks.filter(Boolean).join(" ");
}

async function phonemizeSegment(
	text: string,
	lang: KokoroLangCode,
	rules: PronunciationRule[],
): Promise<string> {
	const segments = splitPunctuationSegments(text);
	const parts = await Promise.all(
		segments.map(async ({ literal, text: seg }) => {
			if (literal) return seg;
			return phonemizeSpeakableSlice(seg, lang, rules);
		}),
	);
	return parts.join("");
}

/**
 * Build the phoneme string kokoro-js feeds to its tokenizer.
 * Pronunciation rules inject IPA directly; they are not markdown.
 */
export async function phonemizeForKokoro(
	text: string,
	voice: KokoroVoiceId,
	pronunciationRules: PronunciationRule[],
): Promise<string> {
	const lang = kokoroLangFromVoice(voice);
	const normalized = kokoroNormalizeText(text);
	const segments = splitPunctuationSegments(normalized);
	const parts = await Promise.all(
		segments.map(async ({ literal, text: seg }) => {
			if (literal) return seg;
			return phonemizeSegment(seg, lang, pronunciationRules);
		}),
	);
	return kokoroPostProcessPhonemes(parts.join(""), lang);
}
