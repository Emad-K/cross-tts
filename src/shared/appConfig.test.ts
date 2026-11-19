import { describe, expect, test } from "bun:test";
import {
	type BackendAvailability,
	coerceTtsBackend,
	effectiveTtsBackend,
} from "./appConfig";

describe("coerceTtsBackend", () => {
	test("keeps a stored choice and ignores junk", () => {
		expect(coerceTtsBackend({ ttsBackend: "dml", cudaEnabled: true })).toBe("dml");
		expect(coerceTtsBackend({ ttsBackend: "vulkan" })).toBe("auto");
	});
	test("migrates the 1.14 settings", () => {
		expect(coerceTtsBackend({ version: 2, cudaEnabled: true })).toBe("cuda");
		expect(coerceTtsBackend({ version: 2, gpuEnabled: false })).toBe("cpu");
		// GPU off wins: "cuda" without its add-on would act as "auto" (WebGPU).
		expect(coerceTtsBackend({ version: 2, cudaEnabled: true, gpuEnabled: false })).toBe("cpu");
		expect(coerceTtsBackend({ version: 2, gpuEnabled: true })).toBe("auto");
		// v1 had GPU off by default; that was never the user's choice.
		expect(coerceTtsBackend({ version: 1, gpuEnabled: false })).toBe("auto");
		expect(coerceTtsBackend({})).toBe("auto");
	});
});

describe("effectiveTtsBackend", () => {
	const none: BackendAvailability = { native: true, dml: false, cuda: "unavailable" };
	test("a GPU provider that can't run here counts as auto", () => {
		expect(effectiveTtsBackend("cuda", none)).toBe("auto");
		expect(effectiveTtsBackend("cuda", { ...none, cuda: "needs-addon" })).toBe("auto");
		expect(effectiveTtsBackend("cuda", { ...none, cuda: "ready" })).toBe("cuda");
		expect(effectiveTtsBackend("dml", none)).toBe("auto");
		expect(effectiveTtsBackend("dml", { ...none, dml: true })).toBe("dml");
	});
	test("CPU choices stay on the CPU; native without a native engine is WASM", () => {
		expect(effectiveTtsBackend("cpu", none)).toBe("cpu");
		expect(effectiveTtsBackend("cpu", { ...none, native: false })).toBe("wasm");
		expect(effectiveTtsBackend("wasm", none)).toBe("wasm");
	});
});
