import { describe, expect, test } from "bun:test";
import {
	addListenRateSample,
	baseSecondsPerChar,
	EMPTY_LISTEN_RATE,
	estimateSecondsForChars,
	MIN_MEASURED_CHARS,
	remainingChapterChars,
} from "./listenTimeEstimate";

describe("addListenRateSample", () => {
	test("accumulates chars and speed-normalized seconds", () => {
		let s = addListenRateSample(EMPTY_LISTEN_RATE, {
			chars: 100,
			seconds: 10,
			speed: 1,
		});
		s = addListenRateSample(s, { chars: 100, seconds: 5, speed: 2 });
		// 2x audio of 5s ≈ 10s at 1x.
		expect(s.chars).toBe(200);
		expect(s.baseSeconds).toBe(20);
	});

	test("ignores invalid samples", () => {
		for (const bad of [
			{ chars: 0, seconds: 5, speed: 1 },
			{ chars: -3, seconds: 5, speed: 1 },
			{ chars: 10, seconds: 0, speed: 1 },
			{ chars: 10, seconds: Number.NaN, speed: 1 },
			{ chars: 10, seconds: 5, speed: 0 },
			{ chars: 10, seconds: 5, speed: -1 },
		]) {
			expect(addListenRateSample(EMPTY_LISTEN_RATE, bad)).toEqual(
				EMPTY_LISTEN_RATE,
			);
		}
	});
});

describe("baseSecondsPerChar", () => {
	test("null while under-sampled", () => {
		expect(baseSecondsPerChar(EMPTY_LISTEN_RATE)).toBeNull();
		const small = addListenRateSample(EMPTY_LISTEN_RATE, {
			chars: MIN_MEASURED_CHARS - 1,
			seconds: 3,
			speed: 1,
		});
		expect(baseSecondsPerChar(small)).toBeNull();
	});

	test("seconds per char once enough is measured", () => {
		const s = addListenRateSample(EMPTY_LISTEN_RATE, {
			chars: 200,
			seconds: 20,
			speed: 1,
		});
		expect(baseSecondsPerChar(s)).toBeCloseTo(0.1);
	});
});

describe("estimateSecondsForChars", () => {
	const rate = addListenRateSample(EMPTY_LISTEN_RATE, {
		chars: 1000,
		seconds: 100,
		speed: 1,
	}); // 0.1 s/char at 1x

	test("scales with chars and divides by playback speed", () => {
		expect(estimateSecondsForChars(rate, 600, 1)).toBeCloseTo(60);
		expect(estimateSecondsForChars(rate, 600, 2)).toBeCloseTo(30);
		expect(estimateSecondsForChars(rate, 600, 0.75)).toBeCloseTo(80);
	});

	test("zero chars estimates zero", () => {
		expect(estimateSecondsForChars(rate, 0, 1)).toBe(0);
	});

	test("null without a usable rate or with bad inputs", () => {
		expect(estimateSecondsForChars(EMPTY_LISTEN_RATE, 600, 1)).toBeNull();
		expect(estimateSecondsForChars(rate, -5, 1)).toBeNull();
		expect(estimateSecondsForChars(rate, 600, 0)).toBeNull();
	});
});

describe("remainingChapterChars", () => {
	test("sums from the current chunk (inclusive)", () => {
		expect(remainingChapterChars([10, 20, 30, 40], 2)).toBe(70);
		expect(remainingChapterChars([10, 20, 30, 40], 0)).toBe(100);
	});

	test("clamps a negative index and handles past-the-end", () => {
		expect(remainingChapterChars([10, 20], -1)).toBe(30);
		expect(remainingChapterChars([10, 20], 5)).toBe(0);
		expect(remainingChapterChars([], 0)).toBe(0);
	});
});

