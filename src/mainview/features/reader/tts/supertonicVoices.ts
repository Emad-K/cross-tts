import { SUPERTONIC_LANGS, SUPERTONIC_STYLES } from "./supertonicModel";
import type { TtsVoice } from "./ttsEngineTypes";

/**
 * Supertonic's 10 preset styles each read every one of its languages, so a
 * voice id is `<lang>:<style>` (e.g. "de:M1"): the language is part of the
 * voice, which keeps it in the audio cache key and in each book's settings.
 */

const languageName = new Intl.DisplayNames(["en"], { type: "language" });

/** English name of a language code ("de" → "German"). */
export function supertonicLanguageName(lang: string): string {
	return languageName.of(lang) ?? lang;
}

export const SUPERTONIC_DEFAULT_VOICE = "en:F1";

export function supertonicVoiceOptions(): TtsVoice[] {
	return SUPERTONIC_LANGS.flatMap((lang) =>
		SUPERTONIC_STYLES.map((style) => ({
			id: `${lang}:${style}`,
			label: `${style[0] === "F" ? "Female" : "Male"} ${style.slice(1)} (${supertonicLanguageName(lang)})`,
			language: lang,
		})),
	);
}
