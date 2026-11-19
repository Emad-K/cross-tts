import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";

/**
 * NVIDIA CUDA for the native engine. onnxruntime-node 1.31 has a CUDA
 * provider on Linux x64 only (its Windows binding has none), and that
 * provider links the CUDA 13 runtime and cuDNN 9. The app never installs
 * those: CUDA is offered only where they already are.
 */

/** Libraries the ONNX Runtime 1.31 CUDA provider loads (driver, CUDA 13, cuDNN 9). */
export const CUDA_LIBS = [
	"libcuda.so.1",
	"libcudart.so.13",
	"libcublas.so.13",
	"libcublasLt.so.13",
	"libcurand.so.10",
	"libcufft.so.12",
	"libcudnn.so.9",
] as const;

/**
 * Which of CUDA_LIBS the dynamic loader wouldn't find, given `ldconfig -p`
 * output and the LD_LIBRARY_PATH directories.
 * ponytail: this is a name lookup, not a dlopen; creating the session is the
 * real test, and that falls back to the CPU.
 */
export function missingCudaLibs(
	ldconfigOutput: string,
	libraryPathDirs: readonly string[] = [],
	exists: (path: string) => boolean = existsSync,
): string[] {
	const cached = new Set<string>();
	// Lines look like "\tlibcuda.so.1 (libc6,x86-64) => /usr/lib/…/libcuda.so.1".
	for (const m of ldconfigOutput.matchAll(/^\s*(\S+) \(([^)]*)\) =>/gm)) {
		if (m[2]!.split(",").includes("x86-64")) cached.add(m[1]!);
	}
	return CUDA_LIBS.filter(
		(lib) =>
			!cached.has(lib) && !libraryPathDirs.some((dir) => exists(join(dir, lib))),
	);
}

let systemReady = false;

/** True once detectCuda found every CUDA library on this machine. */
export function cudaSystemReady(): boolean {
	return systemReady;
}

/**
 * Look for the CUDA libraries, once at startup. Returns a line for the log
 * when an NVIDIA driver is installed but CUDA can't be offered, else null.
 */
export function detectCuda(): Promise<string | null> {
	if (process.platform !== "linux" || process.arch !== "x64") {
		return Promise.resolve(null);
	}
	return new Promise((resolve) => {
		execFile("ldconfig", ["-p"], { timeout: 3000 }, (_err, stdout) => {
			const dirs = (process.env.LD_LIBRARY_PATH ?? "").split(delimiter).filter(Boolean);
			const missing = missingCudaLibs(String(stdout ?? ""), dirs);
			systemReady = missing.length === 0;
			resolve(
				systemReady || missing.includes("libcuda.so.1")
					? null
					: `NVIDIA driver found, but CUDA isn't offered: ${missing.join(", ")} not installed (needs the CUDA 13 runtime and cuDNN 9).`,
			);
		});
	});
}

/**
 * In a packaged app, module paths resolve inside app.asar, but the binding
 * lives in app.asar.unpacked — asar fs only knows files in its header.
 */
export function unpackedPath(path: string): string {
	return path.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");
}

/**
 * Directory holding onnxruntime-node's native binding for this platform.
 * Resolved through transformers.js, whose dependency it is (it isn't ours).
 */
export function ortBindingDir(): string {
	const fromTransformers = createRequire(
		require.resolve("@huggingface/transformers"),
	);
	return unpackedPath(
		join(
			dirname(fromTransformers.resolve("onnxruntime-node")),
			"..",
			"bin",
			"napi-v6",
			process.platform,
			process.arch,
		),
	);
}
