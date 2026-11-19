import { kokoroEngine } from "./kokoroEngine";
import type { TtsEngine } from "./ttsEngineTypes";

/** Registered engines; the first is the default (and the fallback for unknown ids). */
export const TTS_ENGINES: readonly TtsEngine[] = [kokoroEngine];

export function getTtsEngine(id: string): TtsEngine {
	return TTS_ENGINES.find((e) => e.id === id) ?? TTS_ENGINES[0]!;
}

/** `voice` if the engine has it, else the engine's default voice. */
export function coerceEngineVoice(engine: TtsEngine, voice: string): string {
	return engine.listVoices().some((v) => v.id === voice)
		? voice
		: engine.defaultVoice;
}
