import { applyTtsTextRules } from "@shared/ttsTextRules";
import type { KokoroVoiceId } from "./kokoroVoices";
import { phonemizeForKokoro } from "./kokoroPhonemize";
import { getTtsRulesForEngine } from "../ttsRules/ttsRulesStore";

/** Regex-cleaned chunk text; on-screen chunk text is unchanged for highlights. */
export function textForTtsSynthesis(chunkText: string): string {
	return applyTtsTextRules(chunkText, getTtsRulesForEngine());
}

/** Phoneme string for kokoro-js `generate_from_ids` (includes pronunciation rules). */
export async function phonemesForTtsSynthesis(
	chunkText: string,
	voice: KokoroVoiceId,
): Promise<string> {
	const cleaned = textForTtsSynthesis(chunkText);
	const { pronunciationRules } = getTtsRulesForEngine();
	return phonemizeForKokoro(cleaned, voice, pronunciationRules);
}
