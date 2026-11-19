import { expect, test } from "bun:test";
import type { ModelStatusMap } from "@shared/modelAssets";
import { canLoadWithoutDownload, engineModels } from "./modelOnDisk";

const disk = (present: string[], supertonic = false) => ({
	status: Object.fromEntries(
		["cpu", "gpu", "fp16", "phonon"].map((k) => [
			k,
			{ present: present.includes(k), bytes: 0 },
		]),
	) as ModelStatusMap,
	supertonic,
});

test("a fresh install never loads (and so never downloads) on open", () => {
	for (const engine of ["kokoro", "phonon", "supertonic"]) {
		expect(canLoadWithoutDownload(engine, "auto", true, disk([]))).toBe(false);
		expect(canLoadWithoutDownload(engine, "auto", true, null)).toBe(false);
	}
});

test("Kokoro needs fp32, or q8 on the WASM fallback", () => {
	expect(engineModels("kokoro", "auto", true)).toEqual(["gpu"]);
	expect(canLoadWithoutDownload("kokoro", "auto", true, disk(["gpu"]))).toBe(true);
	expect(canLoadWithoutDownload("kokoro", "cuda", true, disk(["cpu"]))).toBe(false);
	expect(canLoadWithoutDownload("kokoro", "wasm", true, disk(["gpu"]))).toBe(false);
	expect(canLoadWithoutDownload("kokoro", "wasm", true, disk(["cpu"]))).toBe(true);
});

test("without a native engine Kokoro may fall to WASM, so q8 must be there too", () => {
	expect(canLoadWithoutDownload("kokoro", "auto", false, disk(["gpu"]))).toBe(false);
	expect(canLoadWithoutDownload("kokoro", "auto", false, disk(["gpu", "cpu"]))).toBe(true);
});

test("Phonon and Supertonic have their own files", () => {
	expect(canLoadWithoutDownload("phonon", "auto", true, disk(["gpu"]))).toBe(false);
	expect(canLoadWithoutDownload("phonon", "auto", true, disk(["phonon"]))).toBe(true);
	expect(canLoadWithoutDownload("supertonic", "auto", true, disk(["gpu"]))).toBe(false);
	expect(canLoadWithoutDownload("supertonic", "auto", true, disk([], true))).toBe(true);
});
