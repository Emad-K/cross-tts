/** Voices shipped with Kokoro-82M v1.0 (display names as in upstream kokoro-js). */
const KOKORO_VOICES = {
	af_heart: { name: "Heart", language: "en-us" },
	af_alloy: { name: "Alloy", language: "en-us" },
	af_aoede: { name: "Aoede", language: "en-us" },
	af_bella: { name: "Bella", language: "en-us" },
	af_jessica: { name: "Jessica", language: "en-us" },
	af_kore: { name: "Kore", language: "en-us" },
	af_nicole: { name: "Nicole", language: "en-us" },
	af_nova: { name: "Nova", language: "en-us" },
	af_river: { name: "River", language: "en-us" },
	af_sarah: { name: "Sarah", language: "en-us" },
	af_sky: { name: "Sky", language: "en-us" },
	am_adam: { name: "Adam", language: "en-us" },
	am_echo: { name: "Echo", language: "en-us" },
	am_eric: { name: "Eric", language: "en-us" },
	am_fenrir: { name: "Fenrir", language: "en-us" },
	am_liam: { name: "Liam", language: "en-us" },
	am_michael: { name: "Michael", language: "en-us" },
	am_onyx: { name: "Onyx", language: "en-us" },
	am_puck: { name: "Puck", language: "en-us" },
	am_santa: { name: "Santa", language: "en-us" },
	bf_emma: { name: "Emma", language: "en-gb" },
	bf_isabella: { name: "Isabella", language: "en-gb" },
	bm_george: { name: "George", language: "en-gb" },
	bm_lewis: { name: "Lewis", language: "en-gb" },
	bf_alice: { name: "Alice", language: "en-gb" },
	bf_lily: { name: "Lily", language: "en-gb" },
	bm_daniel: { name: "Daniel", language: "en-gb" },
	bm_fable: { name: "Fable", language: "en-gb" },
} as const;

export type KokoroVoiceId = keyof typeof KOKORO_VOICES;

export const KOKORO_VOICE_IDS = Object.keys(KOKORO_VOICES) as KokoroVoiceId[];

/** Voice picker entries, e.g. "Heart (af_heart) · en-us". */
export function kokoroVoiceOptions(): { id: string; label: string }[] {
	return KOKORO_VOICE_IDS.map((id) => {
		const { name, language } = KOKORO_VOICES[id];
		return { id, label: `${name} (${id}) · ${language}` };
	});
}

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export function voiceBinUrl(voiceId: string): string {
	return `https://huggingface.co/${KOKORO_MODEL_ID}/resolve/main/voices/${voiceId}.bin`;
}

/** Same path layout as Hugging Face, but served from the local Kokoro hub. */
export function voiceBinUrlFromHub(
	hubBaseUrl: string,
	voiceId: string,
): string {
	const base = hubBaseUrl.endsWith("/") ? hubBaseUrl : `${hubBaseUrl}/`;
	return `${base}${KOKORO_MODEL_ID}/resolve/main/voices/${voiceId}.bin`;
}
