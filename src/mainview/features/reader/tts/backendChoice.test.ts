import { describe, expect, test } from "bun:test";
import { fallbackNotice, loadPlan } from "./backendChoice";

describe("loadPlan", () => {
	test("Kokoro: auto is WebGPU, native CPU, WASM (unchanged)", () => {
		expect(loadPlan("kokoro", "auto")).toEqual(["webgpu", "cpu", "wasm"]);
		expect(loadPlan("kokoro", "webgpu")).toEqual(["webgpu", "cpu", "wasm"]);
	});
	test("Kokoro: a GPU provider falls back to native CPU, then WASM", () => {
		expect(loadPlan("kokoro", "cuda")).toEqual(["cuda", "cpu", "wasm"]);
		expect(loadPlan("kokoro", "dml")).toEqual(["dml", "cpu", "wasm"]);
	});
	test("CPU choices never touch a GPU", () => {
		for (const engine of ["kokoro", "supertonic"]) {
			expect(loadPlan(engine, "cpu")).toEqual(["cpu", "wasm"]);
			expect(loadPlan(engine, "wasm")).toEqual(["wasm"]);
		}
	});
	test("Supertonic: native CPU first unless WebGPU is picked; no CUDA/DirectML", () => {
		expect(loadPlan("supertonic", "auto")).toEqual(["cpu", "webgpu", "wasm"]);
		expect(loadPlan("supertonic", "webgpu")).toEqual(["webgpu", "cpu", "wasm"]);
		expect(loadPlan("supertonic", "cuda")).toEqual(["cpu", "wasm"]);
		expect(loadPlan("supertonic", "dml")).toEqual(["cpu", "wasm"]);
	});
});

describe("fallbackNotice", () => {
	test("says when a picked GPU backend ended up on the CPU", () => {
		expect(fallbackNotice("kokoro", "cuda", "cpu")).toBe(
			"Using the CPU for speech. NVIDIA CUDA couldn't start; details are in the log.",
		);
		expect(fallbackNotice("kokoro", "webgpu", "wasm")).toContain("WebGPU couldn't start");
		expect(fallbackNotice("supertonic", "webgpu", "cpu")).toContain("WebGPU couldn't start");
	});
	test("stays quiet when the choice is running, on auto, and for CPU choices", () => {
		expect(fallbackNotice("kokoro", "dml", "dml")).toBeNull();
		expect(fallbackNotice("kokoro", "auto", "wasm")).toBeNull();
		expect(fallbackNotice("kokoro", "cpu", "wasm")).toBeNull();
		// Supertonic runs CUDA/DirectML choices on the CPU by design.
		expect(fallbackNotice("supertonic", "cuda", "cpu")).toBeNull();
	});
});
