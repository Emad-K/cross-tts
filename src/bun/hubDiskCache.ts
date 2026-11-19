import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * transformers.js 4 hands onnxruntime-node each `.onnx` as a file *path* in
 * Node, so it needs a cache that can produce one; with no cache at all,
 * loading fails ("Unable to get model file path or buffer"). The Kokoro hub
 * already keeps every file it serves on disk under `cacheDir`, in the same
 * `<repo>/resolve/<rev>/<file>` layout as its URLs, so this cache maps a hub
 * URL to that file instead of storing the weights a second time.
 *
 * Only `.onnx` hits are answered: for JSON transformers.js wants bytes, and a
 * path string would be returned in their place. Those re-fetch from the local
 * hub, which is cheap.
 */
export function hubDiskCache(
	hubBaseUrl: string,
	cacheDir: string,
	exists: (path: string) => boolean = existsSync,
) {
	const pathFor = (key: string): string | undefined => {
		if (!key.startsWith(hubBaseUrl) || !key.endsWith(".onnx")) return undefined;
		const rel = key.slice(hubBaseUrl.length).split("/");
		if (rel.some((seg) => seg === "" || seg === "." || seg === "..")) {
			return undefined;
		}
		const file = join(cacheDir, ...rel);
		return exists(file) ? file : undefined;
	};
	return {
		match: async (key: string) => pathFor(key),
		// Nothing to store: the hub wrote the file before answering. Drain the
		// body so the local connection is released. (A first-time .onnx
		// download isn't put at all — match() already finds the file — so
		// that one response body is left to GC.)
		put: async (_key: string, response: Response) => {
			await response.arrayBuffer().catch(() => {});
		},
	};
}
