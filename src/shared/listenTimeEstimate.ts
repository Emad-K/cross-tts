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

/**
 * Typical seconds of 1x-speed audio per character (~15 chars/s), used until a
 * voice has been measured so an estimate shows before the first sentence.
 * ponytail: tuned for alphabetic scripts; a CJK voice reads far fewer chars
 * per second, so its estimate is low until its first sentence is measured.
 */
export const DEFAULT_BASE_SEC_PER_CHAR = 0.065;

/** Measured rates per voice, keyed by {@link listenRateKey}. */
export type ListenRates = Record<string, ListenRateState>;

/** Voices speak at different paces, so each engine + voice has its own rate. */
export function listenRateKey(engineId: string, voice: string): string {
	return `${engineId}:${voice}`;
}

/** Rates from storage; anything malformed is dropped. */
export function coerceListenRates(raw: unknown): ListenRates {
	const out: ListenRates = {};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
	for (const [key, value] of Object.entries(raw)) {
		const v = value as Partial<ListenRateState> | null;
		if (
			v &&
			typeof v.chars === "number" &&
			typeof v.baseSeconds === "number" &&
			Number.isFinite(v.chars) &&
			Number.isFinite(v.baseSeconds) &&
			v.chars > 0 &&
			v.baseSeconds > 0
		) {
			out[key] = { chars: v.chars, baseSeconds: v.baseSeconds };
		}
	}
	return out;
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

/** The voice's measured rate, or the typical default until it has one. */
export function secondsPerChar(state: ListenRateState | undefined): number {
	return (
		baseSecondsPerChar(state ?? EMPTY_LISTEN_RATE) ?? DEFAULT_BASE_SEC_PER_CHAR
	);
}

/**
 * Per-chunk start offsets and the chapter total, in seconds at `speed`.
 *
 * Chunks whose synthesized audio was measured use the exact duration
 * (`measuredBaseSec[i]`, normalized to 1x speed); unmeasured chunks fall back
 * to the chars→seconds rate (the typical default while the voice is still
 * unmeasured). Returns null only for an invalid speed.
 */
export function chapterTimeline(
	chunkCharLengths: number[],
	measuredBaseSec: ReadonlyArray<number | undefined>,
	state: ListenRateState | undefined,
	speed: number,
): ChapterTimeline | null {
	if (!Number.isFinite(speed) || speed <= 0) return null;
	const rate = secondsPerChar(state);
	const starts: number[] = [];
	let acc = 0;
	for (let i = 0; i < chunkCharLengths.length; i++) {
		starts.push(acc);
		const measured = measuredBaseSec[i];
		if (measured !== undefined && Number.isFinite(measured) && measured > 0) {
			acc += measured / speed;
		} else {
			const chars = chunkCharLengths[i];
			if (Number.isFinite(chars) && chars! > 0) acc += (chars! * rate) / speed;
		}
	}
	return { starts, totalSec: acc };
}

/**
 * Listening seconds left in the whole book: what is left of the open chapter
 * plus every later chapter estimated from its text length. `chapterIds` is the
 * reading order (a table of contents may list one chapter file several times;
 * it counts once). Returns null when the open chapter isn't in the list or a
 * later chapter's length is unknown, so a partial sum is never shown.
 */
export function bookTimeLeft(opts: {
	chapterIds: readonly string[];
	chapterChars: Readonly<Record<string, number>>;
	activeChapterId: string | null;
	chapterLeftSec: number;
	secPerChar: number;
	speed: number;
}): number | null {
	const { chapterChars, activeChapterId, chapterLeftSec, secPerChar, speed } =
		opts;
	if (activeChapterId == null || !(speed > 0) || !(secPerChar > 0)) return null;
	const ids = [...new Set(opts.chapterIds)];
	const at = ids.indexOf(activeChapterId);
	if (at < 0) return null;
	let chars = 0;
	for (const id of ids.slice(at + 1)) {
		const n = chapterChars[id];
		if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
		chars += n;
	}
	return Math.max(0, chapterLeftSec) + (chars * secPerChar) / speed;
}
