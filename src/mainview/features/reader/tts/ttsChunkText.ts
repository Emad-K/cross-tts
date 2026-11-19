import { applyTtsTextRules, type TtsTextRulesState } from "@shared/ttsTextRules";
import { normalizeTtsSynthesisText } from "@shared/ttsTextNormalize";
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

/** Regex-cleaned + normalized chunk text; on-screen text is unchanged for highlights. */
export function textForTtsSynthesis(chunkText: string): string {
	return normalizeTtsSynthesisText(applyTtsTextRules(chunkText, rulesForVoice()));
}

/** True when the engine should run (non-empty after rules and contains letters or digits). */
export function isSpeakableChunkText(chunkText: string): boolean {
	const cleaned = textForTtsSynthesis(chunkText);
	if (!cleaned.trim()) return false;
	return /[\p{L}\p{N}]/u.test(cleaned);
}
