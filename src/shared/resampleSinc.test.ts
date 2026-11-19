import { describe, expect, test } from "bun:test";
import { resampleSinc, SincStreamResampler } from "./resampleSinc";

describe("resampleSinc", () => {
	test("equal rates pass through unchanged", () => {
		const input = new Float32Array([0.1, -0.2, 0.3, 0.5]);
		const out = resampleSinc(input, 24000, 24000);
		expect(Array.from(out)).toEqual(Array.from(input));
	});

	test("output length matches the rate ratio", () => {
		const input = new Float32Array(24000);
		const out = resampleSinc(input, 24000, 48000);
		expect(Math.abs(out.length - 48000)).toBeLessThanOrEqual(2);
		const out441 = resampleSinc(input, 24000, 44100);
		expect(Math.abs(out441.length - 44100)).toBeLessThanOrEqual(2);
	});

	test("preserves DC in the interior", () => {
		const input = new Float32Array(4800).fill(1);
		const out = resampleSinc(input, 24000, 48000);
		for (let i = 200; i < out.length - 200; i++) {
			expect(Math.abs(out[i]! - 1)).toBeLessThan(1e-3);
		}
	});

	test("reconstructs a 3 kHz sine far better than linear interpolation", () => {
		// Linear interp error at 3 kHz/24 kHz is ~7.7e-2 peak; windowed sinc
		// should be at least an order of magnitude below that.
		const inRate = 24000;
		const outRate = 48000;
		const f = 3000;
		const input = new Float32Array(2400);
		for (let i = 0; i < input.length; i++) {
			input[i] = Math.sin((2 * Math.PI * f * i) / inRate);
		}
		const out = resampleSinc(input, inRate, outRate);
		let maxErr = 0;
		for (let k = 200; k < out.length - 200; k++) {
			const ideal = Math.sin((2 * Math.PI * f * k) / outRate);
			maxErr = Math.max(maxErr, Math.abs(out[k]! - ideal));
		}
		expect(maxErr).toBeLessThan(0.01);
	});

	test("silence stays silent and random input produces no NaN", () => {
		const silent = resampleSinc(new Float32Array(1000), 24000, 44100);
		expect(silent.every((v) => v === 0)).toBe(true);
		const noisy = new Float32Array(1000);
		for (let i = 0; i < noisy.length; i++) noisy[i] = Math.sin(i * 12.9898) % 1;
		const out = resampleSinc(noisy, 24000, 44100);
		expect(out.every((v) => Number.isFinite(v))).toBe(true);
	});
});

describe("SincStreamResampler", () => {
	for (const outRate of [48000, 44100]) {
		test(`chunked output equals one-shot resampleSinc (24k → ${outRate})`, () => {
			const input = new Float32Array(9000);
			for (let i = 0; i < input.length; i++) {
				input[i] = Math.sin(i * 0.37) * 0.5 + Math.sin(i * 0.011) * 0.3;
			}
			const oneShot = resampleSinc(input, 24000, outRate);
			const r = new SincStreamResampler(24000, outRate);
			const parts: Float32Array[] = [];
			// Uneven chunk sizes, including tiny and empty ones.
			let off = 0;
			for (const n of [0, 5, 1, 700, 3, 2000, 17, 4000]) {
				parts.push(r.process(input.subarray(off, off + n)));
				off += n;
			}
			parts.push(r.process(input.subarray(off)));
			parts.push(r.flush());
			const streamed = Float32Array.from(parts.flatMap((p) => Array.from(p)));
			expect(streamed.length).toBe(oneShot.length);
			let maxErr = 0;
			for (let i = 0; i < oneShot.length; i++) {
				maxErr = Math.max(maxErr, Math.abs(streamed[i]! - oneShot[i]!));
			}
			expect(maxErr).toBeLessThan(1e-6);
		});
	}
});
