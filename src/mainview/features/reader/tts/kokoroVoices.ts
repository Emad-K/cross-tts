/** Voice ids shipped with Kokoro-82M v1.0 (matches `kokoro-js` runtime). */
export const KOKORO_VOICE_IDS = [
	"af_heart",
	"af_alloy",
	"af_aoede",
	"af_bella",
	"af_jessica",
	"af_kore",
	"af_nicole",
	"af_nova",
	"af_river",
	"af_sarah",
	"af_sky",
	"am_adam",
	"am_echo",
	"am_eric",
	"am_fenrir",
	"am_liam",
	"am_michael",
	"am_onyx",
	"am_puck",
	"am_santa",
	"bf_emma",
	"bf_isabella",
	"bm_george",
	"bm_lewis",
	"bf_alice",
	"bf_lily",
	"bm_daniel",
	"bm_fable",
] as const;

export type KokoroVoiceId = (typeof KOKORO_VOICE_IDS)[number];

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export function voiceBinUrl(voiceId: string): string {
	return `https://huggingface.co/${KOKORO_MODEL_ID}/resolve/main/voices/${voiceId}.bin`;
}

/** Same path layout as Hugging Face, but served from the Electrobun localhost hub. */
export function voiceBinUrlFromHub(
	hubBaseUrl: string,
	voiceId: string,
): string {
	const base = hubBaseUrl.endsWith("/") ? hubBaseUrl : `${hubBaseUrl}/`;
	return `${base}${KOKORO_MODEL_ID}/resolve/main/voices/${voiceId}.bin`;
}
