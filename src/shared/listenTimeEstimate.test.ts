import { describe, expect, test } from "bun:test";
import {
	addListenRateSample,
	baseSecondsPerChar,
	chapterTimeline,
	EMPTY_LISTEN_RATE,
	MIN_MEASURED_CHARS,
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

describe("chapterTimeline", () => {
	const rate = addListenRateSample(EMPTY_LISTEN_RATE, {
		chars: 1000,
		seconds: 100,
		speed: 1,
	}); // 0.1 s/char at 1x

	test("estimates every chunk from the rate when nothing is measured", () => {
		const t = chapterTimeline([100, 200, 300], [], rate, 1);
		expect(t).not.toBeNull();
		expect(t!.starts).toEqual([0, 10, 30]);
		expect(t!.totalSec).toBeCloseTo(60);
	});

	test("measured durations override the estimate", () => {
		// Chunk 1 measured at 25s (1x) vs the 20s estimate.
		const t = chapterTimeline([100, 200, 300], [undefined, 25], rate, 1);
		expect(t!.starts).toEqual([0, 10, 35]);
		expect(t!.totalSec).toBeCloseTo(65);
	});

	test("divides by playback speed", () => {
		const t = chapterTimeline([100, 200], [10, 20], rate, 2);
		expect(t!.starts).toEqual([0, 5]);
		expect(t!.totalSec).toBeCloseTo(15);
	});

	test("fully measured chapter needs no rate", () => {
		const t = chapterTimeline([100, 200], [10, 20], EMPTY_LISTEN_RATE, 1);
		expect(t!.starts).toEqual([0, 10]);
		expect(t!.totalSec).toBeCloseTo(30);
	});

	test("null while the rate is unknown and a chunk is unmeasured", () => {
		expect(chapterTimeline([100, 200], [10], EMPTY_LISTEN_RATE, 1)).toBeNull();
	});

	test("null for an invalid speed", () => {
		expect(chapterTimeline([100], [10], rate, 0)).toBeNull();
		expect(chapterTimeline([100], [10], rate, Number.NaN)).toBeNull();
	});

	test("empty chapter yields an empty timeline", () => {
		const t = chapterTimeline([], [], rate, 1);
		expect(t!.starts).toEqual([]);
		expect(t!.totalSec).toBe(0);
	});

	test("skips invalid char counts and invalid measurements", () => {
		const t = chapterTimeline(
			[100, Number.NaN, 100],
			[undefined, -5, 0],
			rate,
			1,
		);
		expect(t!.starts).toEqual([0, 10, 10]);
		expect(t!.totalSec).toBeCloseTo(20);
	});
});

