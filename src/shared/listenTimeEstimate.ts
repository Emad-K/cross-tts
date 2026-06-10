/**
 * Pure listen-time estimation.
 *
 * The TTS engine reports how long each synthesized chunk's audio is. From
 * (characters, audio seconds, speed) samples we derive a speed-normalized
 * seconds-per-character rate, then multiply by the characters still to be
 * read to estimate the remaining listen time. Kept in shared (no DOM/audio
 * types) so it is unit-testable with bun.
 */

export type ListenRateSample = {
	/** Characters of chunk text the audio was synthesized from. */
	chars: number;
	/** Measured audio duration in seconds, as synthesized at `speed`. */
	seconds: number;
	/** Playback speed the audio was synthesized at (Kokoro bakes it in). */
	speed: number;
};

export type ListenRateState = {
	/** Total measured characters across samples. */
	chars: number;
	/** Total audio seconds normalized to 1x speed. */
	baseSeconds: number;
};

export const EMPTY_LISTEN_RATE: ListenRateState = { chars: 0, baseSeconds: 0 };

/** Don't show estimates until at least this many characters were measured. */
export const MIN_MEASURED_CHARS = 40;

/**
 * Fold one measured chunk into the rate. Audio synthesized at speed `s` is
 * ~`s`× shorter than 1x audio, so we store `seconds * speed` to make samples
 * taken at different speeds comparable. Invalid samples are ignored.
 */
export function addListenRateSample(
	state: ListenRateState,
	sample: ListenRateSample,
): ListenRateState {
	if (
		!Number.isFinite(sample.chars) ||
		!Number.isFinite(sample.seconds) ||
		!Number.isFinite(sample.speed) ||
		sample.chars <= 0 ||
		sample.seconds <= 0 ||
		sample.speed <= 0
	) {
		return state;
	}
	return {
		chars: state.chars + sample.chars,
		baseSeconds: state.baseSeconds + sample.seconds * sample.speed,
	};
}

/** Seconds of 1x-speed audio per character, or null while under-sampled. */
export function baseSecondsPerChar(state: ListenRateState): number | null {
	if (state.chars < MIN_MEASURED_CHARS || state.baseSeconds <= 0) return null;
	return state.baseSeconds / state.chars;
}

/**
 * Estimated seconds to listen to `chars` characters at `speed`, or null when
 * the rate is not yet known (or inputs are invalid).
 */
export function estimateSecondsForChars(
	state: ListenRateState,
	chars: number,
	speed: number,
): number | null {
	const rate = baseSecondsPerChar(state);
	if (rate == null || !Number.isFinite(chars) || chars < 0) return null;
	if (!Number.isFinite(speed) || speed <= 0) return null;
	return (chars * rate) / speed;
}

/**
 * Characters left in the current chapter, counting the current chunk in full
 * (estimates are minute-granular, so sub-chunk progress is noise).
 */
export function remainingChapterChars(
	chunkCharLengths: number[],
	currentChunkIndex: number,
): number {
	let total = 0;
	const from = Math.max(0, currentChunkIndex);
	for (let i = from; i < chunkCharLengths.length; i++) {
		const n = chunkCharLengths[i];
		if (Number.isFinite(n) && n! > 0) total += n!;
	}
	return total;
}

/**
 * Characters left in the whole book: the current chapter's remaining chars
 * plus every later chapter's full text length. Returns null when any later
 * chapter's length is unknown (no estimate is better than a wrong one) or
 * when the current chapter index is out of range.
 */
export function remainingBookChars(opts: {
	/** Per-chapter character counts in reading order; null/undefined = unknown. */
	chapterCharCounts: (number | null | undefined)[];
	currentChapterIndex: number;
	remainingCurrentChapterChars: number;
}): number | null {
	const { chapterCharCounts, currentChapterIndex } = opts;
	if (
		currentChapterIndex < 0 ||
		currentChapterIndex >= chapterCharCounts.length
	) {
		return null;
	}
	let total = Math.max(0, opts.remainingCurrentChapterChars);
	for (let i = currentChapterIndex + 1; i < chapterCharCounts.length; i++) {
		const n = chapterCharCounts[i];
		if (n == null || !Number.isFinite(n) || n < 0) return null;
		total += n;
	}
	return total;
}

/**
 * Compact duration for estimate labels: minutes rounded up, hours split out.
 * Examples: 30s → "1m", 4.2min → "5m", 72min → "1h 12m", exactly 2h → "2h".
 */
export function formatListenRemaining(seconds: number): string {
	const totalMin = Math.max(1, Math.ceil(Math.max(0, seconds) / 60));
	if (totalMin < 60) return `${totalMin}m`;
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
