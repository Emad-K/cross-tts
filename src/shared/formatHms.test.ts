import { describe, expect, test } from "bun:test";
import { formatClock, formatHms } from "./formatHms";

describe("formatHms", () => {
	test("always shows zero-padded hours", () => {
		expect(formatHms(0)).toBe("00:00:00");
		expect(formatHms(5)).toBe("00:00:05");
		expect(formatHms(65)).toBe("00:01:05");
		expect(formatHms(23 * 60 + 45)).toBe("00:23:45");
	});

	test("hours and beyond", () => {
		expect(formatHms(3600)).toBe("01:00:00");
		expect(formatHms(3661)).toBe("01:01:01");
		expect(formatHms(25 * 3600 + 2 * 60 + 3)).toBe("25:02:03");
	});

	test("rounds fractional seconds", () => {
		expect(formatHms(59.6)).toBe("00:01:00");
		expect(formatHms(59.4)).toBe("00:00:59");
	});

	test("clamps negatives and tolerates non-finite input", () => {
		expect(formatHms(-30)).toBe("00:00:00");
		expect(formatHms(Number.NaN)).toBe("00:00:00");
		expect(formatHms(Number.POSITIVE_INFINITY)).toBe("00:00:00");
	});
});

describe("formatClock", () => {
	test("m:ss under an hour", () => {
		expect(formatClock(0)).toBe("0:00");
		expect(formatClock(5)).toBe("0:05");
		expect(formatClock(65)).toBe("1:05");
		expect(formatClock(59 * 60 + 59)).toBe("59:59");
	});

	test("h:mm:ss from one hour up", () => {
		expect(formatClock(3600)).toBe("1:00:00");
		expect(formatClock(3725)).toBe("1:02:05");
		expect(formatClock(25 * 3600 + 2 * 60 + 3)).toBe("25:02:03");
	});

	test("forceHours keeps the hour field for aligned pairs", () => {
		expect(formatClock(65, true)).toBe("0:01:05");
		expect(formatClock(0, true)).toBe("0:00:00");
	});

	test("rounds, clamps negatives, tolerates non-finite input", () => {
		expect(formatClock(59.6)).toBe("1:00");
		expect(formatClock(-30)).toBe("0:00");
		expect(formatClock(Number.NaN)).toBe("0:00");
	});
});
