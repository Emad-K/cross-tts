/**
 * One-shot windowed-sinc resampler (pure, bun-testable).
 *
 * Used by the playback path: Linux forces us to resample Kokoro's 24 kHz PCM
 * to the AudioContext rate ourselves (see ttsEngine.rawToBuffer), and linear
 * interpolation leaves audible spectral images above 12 kHz — a faint metallic
 * sheen on every sentence. A Kaiser-windowed sinc kernel removes them.
 *
 * Output sample k corresponds exactly to input position k·inRate/outRate
 * (symmetric kernel, no group delay); edges treat out-of-range input as 0.
 * `SincStreamResampler` below wraps it for the chunked M4B export path.
 */

const TAPS = 32;
const HALF = TAPS / 2;
const PHASES = 256;
const KAISER_BETA = 8;

/** Modified Bessel function of the first kind, order 0 (power series). */
function besselI0(x: number): number {
	let sum = 1;
	let term = 1;
	const half = x / 2;
	for (let k = 1; k < 32; k++) {
		term *= (half / k) * (half / k);
		sum += term;
		if (term < sum * 1e-12) break;
	}
	return sum;
}

function sinc(x: number): number {
	if (x === 0) return 1;
	const px = Math.PI * x;
	return Math.sin(px) / px;
}

/**
 * Polyphase kernel table: (PHASES+1) rows of TAPS coefficients; row p holds
 * the kernel sampled at fractional offset p/PHASES, each row normalized to
 * sum 1 so DC passes exactly. Cached per cutoff (in practice fc = 1: upsample).
 */
const tableCache = new Map<number, Float32Array>();

function kernelTable(fc: number): Float32Array {
	const cached = tableCache.get(fc);
	if (cached) return cached;
	const i0Beta = besselI0(KAISER_BETA);
	const table = new Float32Array((PHASES + 1) * TAPS);
	for (let p = 0; p <= PHASES; p++) {
		const frac = p / PHASES;
		let sum = 0;
		for (let j = 0; j < TAPS; j++) {
			const x = j - HALF + 1 - frac;
			const window =
				Math.abs(x) <= HALF
					? besselI0(KAISER_BETA * Math.sqrt(1 - (x / HALF) * (x / HALF))) /
						i0Beta
					: 0;
			const h = fc * sinc(fc * x) * window;
			table[p * TAPS + j] = h;
			sum += h;
		}
		for (let j = 0; j < TAPS; j++) {
			table[p * TAPS + j]! /= sum;
		}
	}
	tableCache.set(fc, table);
	return table;
}

export function resampleSinc(
	input: Float32Array,
	inRate: number,
	outRate: number,
): Float32Array {
	if (inRate <= 0 || outRate <= 0) {
		throw new Error(`Invalid resample rates: ${inRate} → ${outRate}`);
	}
	if (inRate === outRate) return new Float32Array(input);
	if (input.length === 0) return new Float32Array(0);

	const fc = Math.min(1, outRate / inRate);
	const table = kernelTable(fc);
	const ratio = inRate / outRate;
	const outLen = Math.round((input.length * outRate) / inRate);
	const out = new Float32Array(outLen);
	const len = input.length;

	for (let k = 0; k < outLen; k++) {
		const t = k * ratio;
		const i0 = Math.floor(t);
		const pf = (t - i0) * PHASES;
		const p = Math.floor(pf);
		const pw = pf - p;
		const rowA = p * TAPS;
		const rowB = (p + 1) * TAPS;
		const base = i0 - HALF + 1;
		const jStart = Math.max(0, -base);
		const jEnd = Math.min(TAPS, len - base);
		let sum = 0;
		for (let j = jStart; j < jEnd; j++) {
			const h = table[rowA + j]! * (1 - pw) + table[rowB + j]! * pw;
			sum += input[base + j]! * h;
		}
		out[k] = sum;
	}
	return out;
}

function gcd(a: number, b: number): number {
	while (b) [a, b] = [b, a % b];
	return a;
}

/**
 * Streaming wrapper around `resampleSinc` for audio fed in chunks (M4B
 * export). Each call re-runs the one-shot resampler over the new chunk plus a
 * small overlap of earlier input, and only emits outputs whose whole kernel
 * is covered, so the result is identical to resampling the concatenated input
 * in one go — no zero-padding dips at chunk seams.
 */
export class SincStreamResampler {
	/** Input samples per alignment block / output samples per block. */
	private readonly inBlock: number;
	private readonly outBlock: number;
	/** Pending input; `hist[0]` is absolute input index `histStart`. */
	private hist = new Float32Array(0);
	private histStart = 0;
	private totalIn = 0;
	private emitted = 0;

	constructor(
		readonly inRate: number,
		readonly outRate: number,
	) {
		if (inRate <= 0 || outRate <= 0) {
			throw new Error(`Invalid resample rates: ${inRate} → ${outRate}`);
		}
		const g = gcd(inRate, outRate);
		this.inBlock = inRate / g;
		this.outBlock = outRate / g;
	}

	/** Feed one chunk; returns the output samples now fully determined. */
	process(input: Float32Array): Float32Array {
		this.totalIn += input.length;
		const buf = new Float32Array(this.hist.length + input.length);
		buf.set(this.hist);
		buf.set(input, this.hist.length);
		// Outputs at input position t need input up to floor(t)+HALF.
		const validEnd = Math.max(
			0,
			Math.ceil(
				((this.histStart + buf.length - HALF) * this.outBlock) / this.inBlock,
			),
		);
		const out = this.emit(buf, validEnd);
		// Keep enough left context for the next unemitted output, starting on a
		// block boundary so output indices stay aligned with absolute positions.
		const nextPos = (this.emitted * this.inBlock) / this.outBlock;
		const keepFrom = Math.max(
			this.histStart,
			Math.floor((nextPos - HALF) / this.inBlock) * this.inBlock,
		);
		this.hist = buf.slice(keepFrom - this.histStart);
		this.histStart = keepFrom;
		return out;
	}

	/** Flush the tail (input past the end is treated as silence). */
	flush(): Float32Array {
		const total = Math.round((this.totalIn * this.outRate) / this.inRate);
		const out = this.emit(this.hist, total);
		this.hist = new Float32Array(0);
		return out;
	}

	private emit(buf: Float32Array, endAbs: number): Float32Array {
		if (endAbs <= this.emitted || buf.length === 0) return new Float32Array(0);
		const all = resampleSinc(buf, this.inRate, this.outRate);
		const base = (this.histStart / this.inBlock) * this.outBlock;
		const from = this.emitted - base;
		const to = Math.min(endAbs - base, all.length);
		if (to <= from) return new Float32Array(0);
		this.emitted = base + to;
		return all.slice(from, to);
	}
}
