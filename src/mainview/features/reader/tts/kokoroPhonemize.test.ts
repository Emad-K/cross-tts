import { describe, expect, test } from "bun:test";
import { phonemize } from "phonemizer";
import { kokoroNormalizeText, phonemizeForKokoro } from "./kokoroPhonemize";
import {
	KOKORO_ESPEAK_LANGS,
	KOKORO_VOICE_IDS,
	kokoroLangFromVoice,
} from "./kokoroVoices";

describe("kokoroNormalizeText", () => {
	test("collapses every run of multiple spaces, not just the first", () => {
		// Upstream kokoro-js has the same missing-`g` bug; extra spaces survive
		// normalization, become extra tokens, and shift the style-vector row.
		expect(kokoroNormalizeText("a  b  c   d")).toBe("a b c d");
	});

	test("spells out English-only forms for English voices only", () => {
		expect(kokoroNormalizeText("Dr. Who paid $5 in 1990.")).toBe(
			"Doctor Who paid 5 dollars in 19 90.",
		);
		expect(kokoroNormalizeText("Dr. Who paid $5 in 1990.", false)).toBe(
			"Dr. Who paid $5 in 1990.",
		);
		// Language-neutral steps still run.
		expect(kokoroNormalizeText("«Hola»  (sí)", false)).toBe('"Hola" «sí»');
	});
});

describe("Kokoro voice language → eSpeak language", () => {
	test("maps every voice prefix kokoro-js supports", () => {
		const espeak = (voice: string) =>
			KOKORO_ESPEAK_LANGS[kokoroLangFromVoice(voice)];
		expect(espeak("af_heart")).toBe("en-us");
		expect(espeak("bm_george")).toBe("en");
		expect(espeak("ef_dora")).toBe("es");
		expect(espeak("ff_siwis")).toBe("fr-fr");
		expect(espeak("hf_alpha")).toBe("hi");
		expect(espeak("if_sara")).toBe("it");
		expect(espeak("pm_alex")).toBe("pt-br");
		// ja/zh need misaki G2P (no JS port); unknown prefixes read as en-us.
		expect(espeak("jf_alpha")).toBe("en-us");
	});

	test("only voices the bundled phonemizer can read are offered", async () => {
		expect(KOKORO_VOICE_IDS).toContain("af_heart");
		expect(KOKORO_VOICE_IDS).toContain("bf_emma");
		expect(KOKORO_VOICE_IDS).not.toContain("ef_dora");
		// The bundled espeak-ng data is English-only. When this starts passing,
		// widen BUNDLED_ESPEAK_LANGS in kokoroVoices.ts.
		await expect(phonemize("hola", "es")).rejects.toThrow();
		expect((await phonemizeForKokoro("Hello.", "bf_emma", [])).length).toBeGreaterThan(0);
	});
});
