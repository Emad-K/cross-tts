import { applyTtsTextRules } from "@shared/ttsTextRules";
import { normalizeTtsSynthesisText } from "@shared/ttsTextNormalize";
import { getTtsRulesForEngine } from "../ttsRules/ttsRulesStore";

/** Regex-cleaned + normalized chunk text; on-screen text is unchanged for highlights. */
export function textForTtsSynthesis(chunkText: string): string {
	return normalizeTtsSynthesisText(
		applyTtsTextRules(chunkText, getTtsRulesForEngine()),
	);
}

/** True when the engine should run (non-empty after rules and contains letters or digits). */
export function isSpeakableChunkText(chunkText: string): boolean {
	const cleaned = textForTtsSynthesis(chunkText);
	if (!cleaned.trim()) return false;
	return /[\p{L}\p{N}]/u.test(cleaned);
}

