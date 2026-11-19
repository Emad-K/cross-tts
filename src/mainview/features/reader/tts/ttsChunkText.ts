import { applyTtsTextRules, type TtsTextRulesState } from "@shared/ttsTextRules";
import { normalizeTtsSynthesisText } from "@shared/ttsTextNormalize";
import {
	REPEATED_LINES_RULE_ID,
	detectRepeatedLines,
	stripRepeatedLines,
} from "@shared/ttsClutter";
import { getTtsRulesForEngine } from "../ttsRules/ttsRulesStore";
import { useTtsStore } from "./ttsStore";

/** Id of the builtin rule that strips CJK script (Kokoro can't read it). */
const CJK_RULE_ID = "builtin-cjk";

/** True when the voice reads Chinese/Japanese/Korean script itself. */
export function voiceReadsCjk(engineId: string, voice: string): boolean {
	return engineId === "supertonic" && /^(ja|ko):/.test(voice);
}

/** The rules for the selected voice: CJK script is kept for voices that read it. */
function rulesForVoice(): TtsTextRulesState {
	const rules = getTtsRulesForEngine();
	const { engineId, voice } = useTtsStore.getState();
	if (!voiceReadsCjk(engineId, voice)) return rules;
	return { ...rules, regexRules: rules.regexRules.filter((r) => r.id !== CJK_RULE_ID) };
}

let repeatedLinesMemo: { text: string; lines: Set<string> } | null = null;

/**
 * Running headers of the open chapter (memoized on its text).
 * ponytail: always the chapter open in the reader. While a chapter loads its
 * chunks are built against the previous one (header-only chunks then skip at
 * playback instead of being dropped), and an audiobook export checks every
 * exported chapter against the open one. Pass the source text down from
 * buildTtsChunks / the export loop if that matters.
 */
function repeatedLines(): Set<string> {
	const text = useTtsStore.getState().sourceText;
	if (repeatedLinesMemo?.text !== text) {
		repeatedLinesMemo = { text, lines: detectRepeatedLines(text) };
	}
	return repeatedLinesMemo.lines;
}

/** Regex-cleaned + normalized chunk text; on-screen text is unchanged for highlights. */
export function textForTtsSynthesis(chunkText: string): string {
	const rules = rulesForVoice();
	const skipRepeated = rules.regexRules.some(
		(r) => r.id === REPEATED_LINES_RULE_ID && r.enabled,
	);
	return normalizeTtsSynthesisText(
		applyTtsTextRules(
			skipRepeated ? stripRepeatedLines(chunkText, repeatedLines()) : chunkText,
			rules,
		),
	);
}

/** True when the engine should run (non-empty after rules and contains letters or digits). */
export function isSpeakableChunkText(chunkText: string): boolean {
	const cleaned = textForTtsSynthesis(chunkText);
	if (!cleaned.trim()) return false;
	return /[\p{L}\p{N}]/u.test(cleaned);
}
