import { describe, expect, test } from "bun:test";
import { LinearResampler } from "./resample";

describe("LinearResampler", () => {
	test("2x upsampling interpolates midpoints", () => {
		const r = new LinearResampler(24000, 48000);
		const out = r.process(new Float32Array([0, 1, 0, -1]));
		// t = 0, 0.5, 1, 1.5, 2, 2.5 (3 needs the next chunk)
		expect([...out]).toEqual([0, 0.5, 1, 0.5, 0, -0.5]);
	});

	test("chunked processing matches one-shot processing", () => {
		const input = new Float32Array(1000);
		for (let i = 0; i < input.length; i++) input[i] = Math.sin(i / 7);

		const oneShot = new LinearResampler(24000, 48000).process(input);

		const chunked = new LinearResampler(24000, 48000);
		const parts: number[] = [];
		for (let off = 0; off < input.length; off += 137) {
			parts.push(...chunked.process(input.subarray(off, off + 137)));
		}
		// At most one trailing sample still buffered, the rest must be identical.
		expect(oneShot.length - parts.length).toBeLessThanOrEqual(1);
		for (let i = 0; i < parts.length; i++) {
			expect(parts[i]).toBeCloseTo(oneShot[i]!, 6);
		}
	});

	test("output length tracks the rate ratio", () => {
		const r = new LinearResampler(24000, 48000);
		const out = r.process(new Float32Array(24000));
		expect(Math.abs(out.length - 48000)).toBeLessThanOrEqual(2);
	});

	test("non-integer ratios (24k → 44.1k) stay monotonic and bounded", () => {
		const r = new LinearResampler(24000, 44100);
		const input = new Float32Array(2400).fill(0.25);
		const out = r.process(input);
		expect(Math.abs(out.length - 4410)).toBeLessThanOrEqual(2);
		for (const s of out) expect(s).toBeCloseTo(0.25, 6);
	});

	test("empty input yields empty output; rejects bad rates", () => {
		const r = new LinearResampler(24000, 48000);
		expect(r.process(new Float32Array(0)).length).toBe(0);
		expect(() => new LinearResampler(0, 48000)).toThrow();
	});
});
