import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Why the native engine can't try the CUDA execution provider, or null when
 * it can. onnxruntime-node loads the CUDA EP from a provider library next to
 * its binding; npm ships that library for neither Linux nor Windows (on
 * Linux the package's postinstall can download it, which we skip), and the
 * app never bundles it. With the library present the user still needs CUDA 12
 * and cuDNN 9; a load failure there is caught when the session is created.
 */
export function cudaUnavailableReason(
	platform: string,
	arch: string,
	bindingDir: string,
	exists: (path: string) => boolean = existsSync,
): string | null {
	if (arch !== "x64" || (platform !== "linux" && platform !== "win32")) {
		return `CUDA is only supported on Linux and Windows x64 (this is ${platform} ${arch})`;
	}
	const lib =
		platform === "win32"
			? "onnxruntime_providers_cuda.dll"
			: "libonnxruntime_providers_cuda.so";
	if (!exists(join(bindingDir, lib))) {
		return `${lib} not found next to the ONNX Runtime binding (this build doesn't include the CUDA provider)`;
	}
	return null;
}

/**
 * Directory holding onnxruntime-node's native binding for this platform.
 * Resolved through transformers.js, whose dependency it is (it isn't ours).
 */
export function ortBindingDir(): string {
	const fromTransformers = createRequire(
		require.resolve("@huggingface/transformers"),
	);
	return join(
		dirname(fromTransformers.resolve("onnxruntime-node")),
		"..",
		"bin",
		"napi-v6",
		process.platform,
		process.arch,
	);
}
