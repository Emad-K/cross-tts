import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CUDA_LIBS, missingCudaLibs, unpackedPath } from "./cudaSupport";

// `ldconfig -p` on a machine with the NVIDIA driver but no CUDA toolkit.
const DRIVER_ONLY = `1873 libs found in cache \`/etc/ld.so.cache'
	libcudadebugger.so.1 (libc6,x86-64) => /usr/lib/x86_64-linux-gnu/libcudadebugger.so.1
	libcuda.so.1 (libc6,x86-64) => /usr/lib/x86_64-linux-gnu/libcuda.so.1
	libcuda.so.1 (libc6) => /usr/lib/i386-linux-gnu/libcuda.so.1
	libcuda.so (libc6,x86-64) => /usr/lib/x86_64-linux-gnu/libcuda.so
	libnvidia-ml.so.1 (libc6,x86-64) => /usr/lib/x86_64-linux-gnu/libnvidia-ml.so.1
	libc.so.6 (libc6,x86-64) => /lib/x86_64-linux-gnu/libc.so.6
`;
const line = (lib: string, arch = "libc6,x86-64") => `\t${lib} (${arch}) => /usr/lib/${lib}\n`;
const never = () => false;

describe("missingCudaLibs", () => {
	test("driver without the CUDA runtime: everything but the driver is missing", () => {
		expect(missingCudaLibs(DRIVER_ONLY, [], never)).toEqual(CUDA_LIBS.slice(1));
	});
	test("no NVIDIA at all, or no ldconfig output", () => {
		expect(missingCudaLibs("", [], never)).toEqual([...CUDA_LIBS]);
	});
	test("all libraries in the loader cache", () => {
		expect(missingCudaLibs(CUDA_LIBS.map((l) => line(l)).join(""), [], never)).toEqual([]);
	});
	test("32-bit and CUDA 12 libraries don't count", () => {
		const out =
			CUDA_LIBS.map((l) => line(l, "libc6")).join("") + line("libcudart.so.12");
		expect(missingCudaLibs(out, [], never)).toEqual([...CUDA_LIBS]);
	});
	test("LD_LIBRARY_PATH directories fill the gaps", () => {
		const has = (p: string) => p.startsWith(join("/opt/cuda/lib64", "libcu"));
		expect(missingCudaLibs(DRIVER_ONLY, ["/nope", "/opt/cuda/lib64"], has)).toEqual([]);
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
