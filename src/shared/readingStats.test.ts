import { describe, expect, test } from "bun:test";
import {
	MAX_STATS_DAYS,
	addListening,
	coerceReadingStats,
	dayKey,
	emptyReadingStats,
	markFinished,
	streak,
	weekSeconds,
} from "./readingStats";

const day = (y: number, m: number, d: number, h = 15) => new Date(y, m - 1, d, h);

describe("addListening", () => {
	test("adds to the book and to the local day", () => {
		let s = addListening(emptyReadingStats(), "/a.epub", 30, day(2026, 3, 1));
		s = addListening(s, "/a.epub", 45, day(2026, 3, 1, 23));
		s = addListening(s, null, 10, day(2026, 3, 2));
		expect(s.books).toEqual({ "/a.epub": { listenedSec: 75 } });
		expect(s.days).toEqual({ "2026-03-01": 75, "2026-03-02": 10 });
	});

	test("ignores zero, negative and non-finite amounts", () => {
		const s = emptyReadingStats();
		expect(addListening(s, "/a", 0, day(2026, 1, 1))).toBe(s);
		expect(addListening(s, "/a", -5, day(2026, 1, 1))).toBe(s);
		expect(addListening(s, "/a", Number.NaN, day(2026, 1, 1))).toBe(s);
	});

	test("keeps only the newest days", () => {
		let s = emptyReadingStats();
		for (let i = 0; i < MAX_STATS_DAYS + 5; i++) {
			s = addListening(s, null, 1, new Date(2025, 0, 1 + i, 12));
		}
		const keys = Object.keys(s.days).sort();
		expect(keys).toHaveLength(MAX_STATS_DAYS);
		expect(keys[0]).toBe(dayKey(new Date(2025, 0, 6, 12)));
	});
});

test("markFinished keeps the first finish date and the listened time", () => {
	let s = addListening(emptyReadingStats(), "/a", 100, day(2026, 1, 1));
	s = markFinished(s, "/a", 1000);
	expect(s.books["/a"]).toEqual({ listenedSec: 100, finishedAt: 1000 });
	expect(markFinished(s, "/a", 2000)).toBe(s);
	// Listening again after finishing keeps the date.
	expect(addListening(s, "/a", 5, day(2026, 1, 2)).books["/a"]).toEqual({
		listenedSec: 105,
		finishedAt: 1000,
	});
});

describe("weekSeconds / streak", () => {
	const stats = coerceReadingStats({
		days: {
			"2026-03-10": 600,
			"2026-03-09": 61,
			"2026-03-08": 59, // under a minute: breaks the streak
			"2026-03-07": 600,
			"2026-03-03": 1000, // 7 days before the 10th: outside the window
		},
	});

	test("sums today and the previous six days", () => {
		expect(weekSeconds(stats, day(2026, 3, 10))).toBe(600 + 61 + 59 + 600);
		expect(weekSeconds(stats, day(2026, 3, 9))).toBe(61 + 59 + 600 + 1000);
	});

	test("counts consecutive days of at least a minute", () => {
		expect(streak(stats, day(2026, 3, 10))).toBe(2);
		expect(streak(stats, day(2026, 3, 7))).toBe(1);
	});

	test("a day with no listening yet doesn't reset yesterday's streak", () => {
		expect(streak(stats, day(2026, 3, 11))).toBe(2);
		expect(streak(stats, day(2026, 3, 12))).toBe(0);
	});
});

test("coerceReadingStats drops junk", () => {
	expect(
		coerceReadingStats({
			books: {
				"/ok": { listenedSec: 12, finishedAt: 5 },
				"/zero": { listenedSec: 0 },
				"/bad": { listenedSec: "12" },
				"/done": { finishedAt: 9 },
			},
			days: { "2026-01-01": 5, "not-a-day": 5, "2026-01-02": -1 },
		}),
	).toEqual({
		version: 1,
		books: {
			"/ok": { listenedSec: 12, finishedAt: 5 },
			"/done": { listenedSec: 0, finishedAt: 9 },
		},
		days: { "2026-01-01": 5 },
	});
	expect(coerceReadingStats("x")).toEqual(emptyReadingStats());
});
