import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cudaUnavailableReason } from "./cudaSupport";

describe("cudaUnavailableReason", () => {
	test("rejects unsupported platforms without touching the disk", () => {
		const never = () => {
			throw new Error("no disk access expected");
		};
		expect(cudaUnavailableReason("darwin", "arm64", "/b", never)).toContain(
			"only supported",
		);
		expect(cudaUnavailableReason("linux", "arm64", "/b", never)).toContain(
			"only supported",
		);
	});

	test("needs the platform's provider library next to the binding", () => {
		expect(cudaUnavailableReason("linux", "x64", "/b", () => false)).toContain(
			"libonnxruntime_providers_cuda.so not found",
		);
		expect(cudaUnavailableReason("win32", "x64", "/b", () => false)).toContain(
			"onnxruntime_providers_cuda.dll not found",
		);
		const seen: string[] = [];
		const has = (p: string) => (seen.push(p), true);
		expect(cudaUnavailableReason("linux", "x64", "/b", has)).toBeNull();
		expect(seen).toEqual([join("/b", "libonnxruntime_providers_cuda.so")]);
	});
});
