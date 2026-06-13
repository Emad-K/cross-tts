/**
 * Pure listen-time estimation.
 *
 * The TTS engine reports how long each synthesized chunk's audio is. From
 * (characters, audio seconds, speed) samples we derive a speed-normalized
 * seconds-per-character rate, then build a chapter timeline: exact durations
 * for chunks already synthesized, rate-based estimates for the rest. Kept in
 * shared (no DOM/audio types) so it is unit-testable with bun.
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

export type ChapterTimeline = {
	/** Start offset of each chunk, in listening seconds at the playback speed. */
	starts: number[];
	/** Full chapter length in listening seconds at the playback speed. */
	totalSec: number;
};

/**
 * Per-chunk start offsets and the chapter total, in seconds at `speed`.
 *
 * Chunks whose synthesized audio was measured use the exact duration
 * (`measuredBaseSec[i]`, normalized to 1x speed); unmeasured chunks fall back
 * to the chars→seconds rate. Returns null while the rate is unknown and any
 * chunk is still unmeasured — a partial timeline would mislabel the total.
 */
export function chapterTimeline(
	chunkCharLengths: number[],
	measuredBaseSec: ReadonlyArray<number | undefined>,
	state: ListenRateState,
	speed: number,
): ChapterTimeline | null {
	if (!Number.isFinite(speed) || speed <= 0) return null;
	const rate = baseSecondsPerChar(state);
	const starts: number[] = [];
	let acc = 0;
	for (let i = 0; i < chunkCharLengths.length; i++) {
		starts.push(acc);
		const measured = measuredBaseSec[i];
		if (measured !== undefined && Number.isFinite(measured) && measured > 0) {
			acc += measured / speed;
		} else {
			if (rate == null) return null;
			const chars = chunkCharLengths[i];
			if (Number.isFinite(chars) && chars! > 0) acc += (chars! * rate) / speed;
		}
	}
	return { starts, totalSec: acc };
}
