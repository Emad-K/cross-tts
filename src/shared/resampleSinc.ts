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
 * The M4B export path keeps the streaming LinearResampler — this one operates
 * on a whole chunk at once.
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
