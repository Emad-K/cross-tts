import { describe, expect, test } from "bun:test";
import { formatHms } from "./formatHms";

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
