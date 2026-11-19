import { splitLongSentence } from "./chunkText";

/**
 * Pure helpers for the Phonon engine: speed → the model's duration
 * conditioner, the per-call text cap, and the runaway-generation check.
 */

/** Longest text handed to one Phonon generation (the runtime splits further). */
export const PHONON_MAX_CHARS = 300;

/** `text` in pieces of at most `maxChars`, broken at clauses, then spaces. */
export function splitForPhonon(text: string, maxChars = PHONON_MAX_CHARS): string[] {
	return splitLongSentence(text, 0, text.length, maxChars).map((c) => c.text);
}

/**
 * Measured on phonon-31m-en (3 sentences, voice "default", CPU): audio length
 * relative to duration_delta 0 → duration_delta. Past ±0.5 it barely moves
 * (+1.0 gave 1.24×), so speeds outside ~0.83×–1.33× are clamped.
 * ponytail: calibration from one 3-sentence run; re-measure if voices disagree.
 */
const LENGTH_TO_DELTA: readonly (readonly [number, number])[] = [
	[0.749, -0.5],
	[0.842, -0.2],
	[1, 0],
	[1.126, 0.2],
	[1.209, 0.5],
];

/** Phonon's `duration_delta` conditioner value closest to playback `speed`. */
export function durationDeltaForSpeed(speed: number): number {
	const length = 1 / speed;
	const t = LENGTH_TO_DELTA;
	if (!(length > t[0]![0])) return t[0]![1];
	for (let i = 1; i < t.length; i++) {
		const [l1, d1] = t[i]!;
		if (length <= l1) {
			const [l0, d0] = t[i - 1]!;
			return Math.round((d0 + ((length - l0) / (l1 - l0)) * (d1 - d0)) * 100) / 100;
		}
	}
	return t[t.length - 1]![1];
}

/** Normal speech is ~0.06–0.075 s per character; this allows about twice that. */
const MAX_SECONDS_PER_CHAR = 0.15;
const MAX_SECONDS_BASE = 2;
/** Longest near-silent stretch seen in normal output is ~0.8 s. */
const MAX_QUIET_SECONDS = 2.5;
const QUIET_RMS = 3e-3;

/**
 * Watches streamed audio for a generation that ran away: far more audio than
 * the text needs, or a long stretch of silence (the model looping on nothing).
 */
export class RunawayWatch {
	readonly maxSamples: number;
	private samples = 0;
	private quiet = 0;

	constructor(
		chars: number,
		private readonly sampleRate: number,
	) {
		this.maxSamples = Math.round(
			(MAX_SECONDS_BASE + chars * MAX_SECONDS_PER_CHAR) * sampleRate,
		);
	}

	/** Feed the next piece; true once the generation counts as runaway. */
	push(pcm: Float32Array): boolean {
		this.samples += pcm.length;
		let sumSq = 0;
		for (let i = 0; i < pcm.length; i++) sumSq += pcm[i]! * pcm[i]!;
		const rms = pcm.length ? Math.sqrt(sumSq / pcm.length) : 0;
		this.quiet = rms < QUIET_RMS ? this.quiet + pcm.length : 0;
		return (
			this.samples > this.maxSamples ||
			this.quiet > MAX_QUIET_SECONDS * this.sampleRate
		);
	}
}
