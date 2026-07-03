/**
 * Kokoro's tokenizer is character-level over the phoneme alphabet with
 * `model_max_length: 512`; anything longer is silently truncated — the tail of
 * the sentence is never spoken and the lost EOS token garbles the ending.
 * Splitting the phoneme string (1 char ≈ 1 token, upper bound: the tokenizer's
 * normalizer only ever removes characters) keeps every piece under the limit
 * so nothing is dropped.
 *
 * Pieces concatenate back to the exact input. Each cut prefers the last
 * punctuation inside the window (a natural prosodic pause), then the last
 * space, then a hard cut.
 */

/** Mirrors kokoro-js PUNCTUATION — characters the model treats as pause points. */
const SPLIT_PUNCTUATION = new Set(';:,.!?¡¿—…"«»“”(){}[]');

export function splitPhonemesForTokenLimit(
	phonemes: string,
	maxLen: number,
): string[] {
	const limit = Math.max(1, Math.floor(maxLen));
	const pieces: string[] = [];
	let rest = phonemes;
	while (rest.length > limit) {
		let cut = 0;
		for (let i = limit - 1; i >= 0; i--) {
			if (SPLIT_PUNCTUATION.has(rest[i]!)) {
				cut = i + 1;
				break;
			}
		}
		if (cut === 0) {
			for (let i = limit - 1; i >= 0; i--) {
				if (rest[i] === " ") {
					cut = i + 1;
					break;
				}
			}
		}
		if (cut === 0) cut = limit;
		pieces.push(rest.slice(0, cut));
		rest = rest.slice(cut);
	}
	if (rest.length > 0 || pieces.length === 0) pieces.push(rest);
	return pieces;
}
