import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cudaUnavailableReason, unpackedPath } from "./cudaSupport";

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

describe("unpackedPath", () => {
	test("maps app.asar paths to app.asar.unpacked", () => {
		expect(unpackedPath("/opt/X/resources/app.asar/node_modules/a")).toBe(
			"/opt/X/resources/app.asar.unpacked/node_modules/a",
		);
		expect(unpackedPath("C:\\X\\app.asar\\node_modules")).toBe(
			"C:\\X\\app.asar.unpacked\\node_modules",
		);
		expect(unpackedPath("/dev/node_modules/a")).toBe("/dev/node_modules/a");
		expect(unpackedPath("/x/app.asar.unpacked/a")).toBe("/x/app.asar.unpacked/a");
	});
});
