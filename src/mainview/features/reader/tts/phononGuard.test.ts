import { describe, expect, test } from "bun:test";
import { durationDeltaForSpeed, RunawayWatch, splitForPhonon } from "./phononGuard";

describe("durationDeltaForSpeed", () => {
	test("1x is neutral, faster is negative, slower positive", () => {
		expect(durationDeltaForSpeed(1)).toBe(0);
		expect(durationDeltaForSpeed(1.25)).toBeLessThan(-0.2);
		expect(durationDeltaForSpeed(1.25)).toBeGreaterThan(-0.5);
		expect(durationDeltaForSpeed(0.9)).toBeGreaterThan(0);
	});
	test("clamps speeds the model can't reach", () => {
		expect(durationDeltaForSpeed(2)).toBe(-0.5);
		expect(durationDeltaForSpeed(0.75)).toBe(0.5);
		expect(durationDeltaForSpeed(Number.NaN)).toBe(-0.5);
	});
});

describe("splitForPhonon", () => {
	test("keeps short text whole and cuts long text at clauses", () => {
		expect(splitForPhonon("Hello there.")).toEqual(["Hello there."]);
		const long = `${"word ".repeat(30)}and then, ${"more ".repeat(30)}end.`;
		const parts = splitForPhonon(long, 200);
		expect(parts.length).toBeGreaterThan(1);
		expect(parts.every((p) => p.length <= 200)).toBe(true);
		expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " ").trim());
	});
});

describe("RunawayWatch", () => {
	const rate = 1000;
	const tone = (n: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i) * 0.3);
	test("passes speech of a plausible length", () => {
		const w = new RunawayWatch(20, rate); // budget 2 + 3 = 5 s
		for (let i = 0; i < 4; i++) expect(w.push(tone(1000))).toBe(false);
	});
	test("flags too much audio for the text", () => {
		const w = new RunawayWatch(20, rate);
		let flagged = false;
		for (let i = 0; i < 6; i++) flagged ||= w.push(tone(1000));
		expect(flagged).toBe(true);
	});
	test("flags a long silent stretch, but not short pauses", () => {
		const w = new RunawayWatch(200, rate);
		expect(w.push(new Float32Array(2000))).toBe(false);
		expect(w.push(tone(100))).toBe(false);
		expect(w.push(new Float32Array(2000))).toBe(false);
		expect(w.push(new Float32Array(1000))).toBe(true);
	});
});
