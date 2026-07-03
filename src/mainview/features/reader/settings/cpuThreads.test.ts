import { describe, expect, test } from "bun:test";
import { autoCpuThreads, maxSelectableCpuThreads } from "./cpuThreads";

describe("cpu thread policy", () => {
	test("max selectable is cores minus one, floor 1", () => {
		expect(maxSelectableCpuThreads(16)).toBe(15);
		expect(maxSelectableCpuThreads(2)).toBe(1);
		expect(maxSelectableCpuThreads(1)).toBe(1);
		expect(maxSelectableCpuThreads(0)).toBe(1);
	});

	test("auto caps at 4 threads on big CPUs", () => {
		expect(autoCpuThreads(16)).toBe(4);
		expect(autoCpuThreads(32)).toBe(4);
	});

	test("auto uses cores minus one on small CPUs", () => {
		expect(autoCpuThreads(4)).toBe(3);
		expect(autoCpuThreads(2)).toBe(1);
		expect(autoCpuThreads(0)).toBe(1);
	});
});
