import { describe, expect, test } from "bun:test";
import {
	formatSleepRemaining,
	minutesToMs,
	parseCustomSleepMinutes,
	shouldSleepAtChapterEnd,
} from "./sleepTimerUtils";

describe("sleepTimerUtils", () => {
	test("minutesToMs", () => {
		expect(minutesToMs(30)).toBe(30 * 60 * 1000);
	});

	test("formatSleepRemaining is always hh:mm:ss", () => {
		expect(formatSleepRemaining(125_000)).toBe("00:02:05");
		expect(formatSleepRemaining(5_000)).toBe("00:00:05");
		expect(formatSleepRemaining(0)).toBe("00:00:00");
	});

	test("formatSleepRemaining with hours", () => {
		expect(formatSleepRemaining(3_661_000)).toBe("01:01:01");
	});

	test("formatSleepRemaining rounds partial seconds up", () => {
		expect(formatSleepRemaining(1_400)).toBe("00:00:02");
	});

	test("parseCustomSleepMinutes accepts valid range", () => {
		expect(parseCustomSleepMinutes("30")).toBe(30);
		expect(parseCustomSleepMinutes("  90 ")).toBe(90);
	});

	test("parseCustomSleepMinutes rejects invalid", () => {
		expect(parseCustomSleepMinutes("0")).toBeNull();
		expect(parseCustomSleepMinutes("abc")).toBeNull();
		expect(parseCustomSleepMinutes("2000")).toBeNull();
	});
});

describe("shouldSleepAtChapterEnd", () => {
	const chapterIds = ["c1", "c2", "c3", "c4"];

	test("no target chapter fires immediately (end of current chapter)", () => {
		expect(
			shouldSleepAtChapterEnd({
				targetChapterId: null,
				chapterIds,
				finishedChapterId: "c1",
			}),
		).toBe(true);
	});

	test("no chapter structure (TXT) fires at end of document", () => {
		expect(
			shouldSleepAtChapterEnd({
				targetChapterId: "c3",
				chapterIds: [],
				finishedChapterId: null,
			}),
		).toBe(true);
	});

	test("waits until the target chapter finishes", () => {
		expect(
			shouldSleepAtChapterEnd({
				targetChapterId: "c3",
				chapterIds,
				finishedChapterId: "c1",
			}),
		).toBe(false);
		expect(
			shouldSleepAtChapterEnd({
				targetChapterId: "c3",
				chapterIds,
				finishedChapterId: "c3",
			}),
		).toBe(true);
	});

	test("fires when the finished chapter is past the target", () => {
		expect(
			shouldSleepAtChapterEnd({
				targetChapterId: "c2",
				chapterIds,
				finishedChapterId: "c4",
			}),
		).toBe(true);
	});

	test("fails safe when ids are unknown", () => {
		expect(
			shouldSleepAtChapterEnd({
				targetChapterId: "gone",
				chapterIds,
				finishedChapterId: "c1",
			}),
		).toBe(true);
		expect(
			shouldSleepAtChapterEnd({
				targetChapterId: "c3",
				chapterIds,
				finishedChapterId: null,
			}),
		).toBe(true);
		expect(
			shouldSleepAtChapterEnd({
				targetChapterId: "c3",
				chapterIds,
				finishedChapterId: "gone",
			}),
		).toBe(true);
	});
});
