import { describe, expect, test } from "bun:test";
import { describeAdapter, softwareAdapterReason } from "./gpuAdapter";

const info = (o: Partial<Parameters<typeof describeAdapter>[0]>) => ({
	vendor: "",
	architecture: "",
	device: "",
	description: "",
	...o,
});

describe("softwareAdapterReason", () => {
	test("flags fallback and software rasterizers", () => {
		expect(softwareAdapterReason(info({ isFallbackAdapter: true }))).toBe(
			"fallback adapter",
		);
		expect(
			softwareAdapterReason(info({ description: "llvmpipe (LLVM 15.0.7, 256 bits)" })),
		).toBe("llvmpipe");
		expect(softwareAdapterReason(info({ device: "Lavapipe" }))).toBe("lavapipe");
		expect(
			softwareAdapterReason(info({ vendor: "google", architecture: "swiftshader" })),
		).toBe("swiftshader");
	});

	test("accepts a real GPU", () => {
		const nvidia = info({ vendor: "nvidia", architecture: "ampere" });
		expect(softwareAdapterReason(nvidia)).toBeNull();
		expect(describeAdapter(nvidia)).toBe("nvidia / ampere");
	});
});
