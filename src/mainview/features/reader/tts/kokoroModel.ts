import {
	AutoTokenizer,
	StyleTextToSpeech2Model,
	Tensor,
	type PretrainedModelOptions,
	type PreTrainedTokenizer,
} from "@huggingface/transformers";
import { KOKORO_MODEL_ID } from "./kokoroVoices";

/**
 * Kokoro on transformers.js, without kokoro-js (which pins transformers ^3).
 * Shared by the renderer worker (WebGPU / WASM) and the native utility
 * process (onnxruntime-node): same model call, same style-vector indexing.
 */

export const KOKORO_SAMPLE_RATE = 24000;

/** Floats per style vector; a voice `.bin` is 510 of them back to back. */
const STYLE_DIM = 256;
const MAX_STYLE_INDEX = 509;

export type Kokoro = {
	model: StyleTextToSpeech2Model;
	tokenizer: PreTrainedTokenizer;
};

export async function loadKokoro(
	options: Pick<
		PretrainedModelOptions,
		"dtype" | "device" | "session_options" | "progress_callback"
	>,
): Promise<Kokoro> {
	const [model, tokenizer] = await Promise.all([
		StyleTextToSpeech2Model.from_pretrained(KOKORO_MODEL_ID, options),
		AutoTokenizer.from_pretrained(KOKORO_MODEL_ID),
	]);
	return { model, tokenizer };
}

/**
 * Offset of the style vector for an input of `tokenCount` ids (BOS/EOS
 * included). Kokoro's voices hold one style per phoneme length, so the
 * vector is picked by token count, clamped to the last one.
 */
export function styleOffset(tokenCount: number): number {
	return (
		STYLE_DIM * Math.min(Math.max(tokenCount - 2, 0), MAX_STYLE_INDEX)
	);
}

/** Synthesize one phoneme piece (must fit the tokenizer's 512 limit). */
export async function generatePhonemes(
	kokoro: Kokoro,
	phonemes: string,
	voiceData: Float32Array,
	speed: number,
): Promise<Float32Array> {
	const { input_ids } = kokoro.tokenizer(phonemes, { truncation: true });
	const offset = styleOffset(input_ids.dims.at(-1) ?? 0);
	const { waveform } = await kokoro.model({
		input_ids,
		style: new Tensor(
			"float32",
			voiceData.slice(offset, offset + STYLE_DIM),
			[1, STYLE_DIM],
		),
		speed: new Tensor("float32", [speed], [1]),
	});
	return waveform.data as Float32Array;
}

/** Memoized voice loader; a failed load is retried on the next call. */
export function voiceLoader(
	fetchBin: (voiceId: string) => Promise<ArrayBuffer>,
): (voiceId: string) => Promise<Float32Array> {
	const voices = new Map<string, Promise<Float32Array>>();
	return (voiceId) => {
		let voice = voices.get(voiceId);
		if (!voice) {
			voice = fetchBin(voiceId).then((buf) => new Float32Array(buf));
			voice.catch(() => voices.delete(voiceId));
			voices.set(voiceId, voice);
		}
		return voice;
	};
}
