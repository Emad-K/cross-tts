import { describe, expect, test } from "bun:test";
import {
	formatSleepRemaining,
	minutesToMs,
	parseCustomSleepMinutes,
} from "./sleepTimerUtils";

describe("sleepTimerUtils", () => {
	test("minutesToMs", () => {
		expect(minutesToMs(30)).toBe(30 * 60 * 1000);
	});

	test("formatSleepRemaining under one hour", () => {
		expect(formatSleepRemaining(125_000)).toBe("2:05");
	});

	test("formatSleepRemaining with hours", () => {
		expect(formatSleepRemaining(3_661_000)).toBe("1:01:01");
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
