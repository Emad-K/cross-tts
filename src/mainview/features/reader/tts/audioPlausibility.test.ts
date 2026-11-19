import { describe, expect, test } from "bun:test";
import { isPlausibleAudio } from "./audioPlausibility";

function sine(n: number, amp: number): Float32Array {
	const a = new Float32Array(n);
	for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * 220 * i) / 24000);
	return a;
}

describe("isPlausibleAudio", () => {
	test("accepts speech-level audio", () => {
		expect(isPlausibleAudio(sine(24000, 0.3))).toBe(true);
		expect(isPlausibleAudio(sine(2400, 0.01))).toBe(true);
	});

	test("rejects empty, silent, non-finite and wildly clipped audio", () => {
		expect(isPlausibleAudio(new Float32Array(0))).toBe(false);
		expect(isPlausibleAudio(new Float32Array(24000))).toBe(false);
		const nan = sine(24000, 0.3);
		nan[100] = Number.NaN;
		expect(isPlausibleAudio(nan)).toBe(false);
		const inf = sine(24000, 0.3);
		inf[5] = Number.POSITIVE_INFINITY;
		expect(isPlausibleAudio(inf)).toBe(false);
		expect(isPlausibleAudio(sine(24000, 10))).toBe(false);
	});
});
