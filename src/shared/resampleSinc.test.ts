import { describe, expect, test } from "bun:test";
import { resampleSinc } from "./resampleSinc";

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
