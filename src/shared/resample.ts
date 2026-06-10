/**
 * Streaming linear resampler (pure, bun-testable).
 *
 * Used by the M4B export path: platform AAC encoders (e.g. Windows
 * MediaFoundation) often only accept 44.1/48 kHz input, while Kokoro
 * synthesizes at 24 kHz. Linear interpolation is plenty for upsampling
 * speech. State is carried across chunks so chunk boundaries stay seamless.
 */
export class LinearResampler {
	/** Position of the next output sample, in input-sample units (absolute). */
	private t = 0;
	/** Absolute input-sample index of the first sample of the next chunk. */
	private baseIndex = 0;
	/** Last input sample of the previous chunk (for cross-chunk interpolation). */
	private prev = 0;

	constructor(
		readonly inRate: number,
		readonly outRate: number,
	) {
		if (inRate <= 0 || outRate <= 0) {
			throw new Error(`Invalid resample rates: ${inRate} → ${outRate}`);
		}
	}

	/** Feed one PCM chunk; returns the output samples available so far. */
	process(input: Float32Array): Float32Array {
		if (input.length === 0) return new Float32Array(0);
		const step = this.inRate / this.outRate;
		const startAbs = this.baseIndex;
		const endAbs = startAbs + input.length - 1;
		const estimate = Math.ceil((endAbs - this.t) / step) + 2;
		const out = new Float32Array(Math.max(estimate, 0));
		let n = 0;
		// Each output sample sits at absolute input position `t`; interpolate
		// between floor(t) and floor(t)+1. The sample at floor(t)+1 may not
		// exist yet — stop and resume on the next chunk.
		while (true) {
			const i = Math.floor(this.t);
			if (i + 1 > endAbs) break;
			const s0 = i < startAbs ? this.prev : input[i - startAbs]!;
			const s1 = input[i + 1 - startAbs]!;
			out[n++] = s0 + (s1 - s0) * (this.t - i);
			this.t += step;
		}
		this.prev = input[input.length - 1]!;
		this.baseIndex = endAbs + 1;
		return out.subarray(0, n);
	}
}
