/**
 * Estimated word timing inside one spoken chunk.
 *
 * The engines report no word timestamps, so the current word is estimated
 * from how far playback is through the chunk: each word gets a share of the
 * time proportional to its length, and punctuation after it adds a pause.
 * Pure (no DOM), so it is unit-testable with bun.
 */

export type TimedWord = {
	/** Offsets of the word in the chunk text (`end` exclusive). */
	start: number;
	end: number;
	/** Share of the chunk (0..1] that has elapsed when this word ends. */
	until: number;
};

/** Pause after a word, in "letters" of speaking time. */
const CLAUSE_PAUSE = 3;
const SENTENCE_PAUSE = 6;

function pauseWeight(punctuation: string): number {
	if (/[.!?…。！？]/u.test(punctuation)) return SENTENCE_PAUSE;
	if (/[,;:—–，、；：]/u.test(punctuation)) return CLAUSE_PAUSE;
	return 0;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/** Words of `text` with the share of the chunk elapsed at each word's end. */
export function wordTimeline(text: string): TimedWord[] {
	const words: { start: number; end: number; weight: number }[] = [];
	for (const seg of segmenter.segment(text)) {
		const last = words[words.length - 1];
		if (seg.isWordLike) {
			words.push({
				start: seg.index,
				end: seg.index + seg.segment.length,
				weight: seg.segment.length,
			});
		} else if (last) {
			// A pause belongs to the word before it; count each one once
			// ("..." is one pause, not three).
			last.weight = Math.max(
				last.weight,
				last.end - last.start + pauseWeight(seg.segment),
			);
		}
	}
	const total = words.reduce((sum, w) => sum + w.weight, 0);
	let acc = 0;
	return words.map((w) => {
		acc += w.weight;
		return { start: w.start, end: w.end, until: acc / total };
	});
}

/** Index of the word being spoken at `progress` (0..1), or -1 with no words. */
export function wordIndexAtProgress(
	timeline: readonly TimedWord[],
	progress: number,
): number {
	if (timeline.length === 0) return -1;
	const p = Number.isFinite(progress) ? progress : 0;
	const i = timeline.findIndex((w) => p < w.until);
	return i === -1 ? timeline.length - 1 : i;
}
