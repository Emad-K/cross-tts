import { describe, expect, test } from "bun:test";
import { describeAdapter, softwareAdapterReason } from "./gpuAdapter";

const info = (o: Partial<Parameters<typeof describeAdapter>[0]>) => ({
	vendor: "",
	architecture: "",
	device: "",
	description: "",
	...o,
});
const adapter = (o: Partial<Parameters<typeof describeAdapter>[0]>) => ({
	info: info(o),
});

describe("softwareAdapterReason", () => {
	test("flags fallback and software rasterizers", () => {
		expect(softwareAdapterReason(adapter({ isFallbackAdapter: true }))).toBe(
			"fallback adapter",
		);
		expect(
			softwareAdapterReason(adapter({ description: "llvmpipe (LLVM 15.0.7, 256 bits)" })),
		).toBe("llvmpipe");
		expect(softwareAdapterReason(adapter({ device: "Lavapipe" }))).toBe("lavapipe");
		expect(
			softwareAdapterReason(adapter({ vendor: "google", architecture: "swiftshader" })),
		).toBe("swiftshader");
	});

	test("reads the fallback flag from the adapter too (older Chromium)", () => {
		expect(
			softwareAdapterReason({ info: info({}), isFallbackAdapter: true }),
		).toBe("fallback adapter");
		expect(
			softwareAdapterReason(adapter({ description: "Microsoft Basic Render Driver" })),
		).toBe("microsoft basic render");
	});

	test("accepts a real GPU", () => {
		const nvidia = info({ vendor: "nvidia", architecture: "ampere" });
		expect(softwareAdapterReason({ info: nvidia })).toBeNull();
		expect(describeAdapter(nvidia)).toBe("nvidia / ampere");
	});
});
