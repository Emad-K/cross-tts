type AdapterInfo = Pick<
	GPUAdapterInfo,
	"vendor" | "architecture" | "device" | "description"
> & { isFallbackAdapter?: boolean };

/** One log line's worth of adapter identity. */
export function describeAdapter(info: AdapterInfo): string {
	const parts = [info.vendor, info.architecture, info.device, info.description];
	return parts.filter(Boolean).join(" / ") || "unknown adapter";
}

/**
 * Why `adapter` is a software rasterizer rather than a GPU (fallback adapter,
 * Mesa llvmpipe/lavapipe, SwiftShader, WARP), or null for a real GPU. Running
 * the model there is slower than the CPU backends, so it counts as "no GPU".
 * The fallback flag moved from GPUAdapter to GPUAdapterInfo in later
 * Chromium releases (Electron 33 only has the adapter one), so check both.
 */
export function softwareAdapterReason(adapter: {
	info: AdapterInfo;
	isFallbackAdapter?: boolean;
}): string | null {
	const { info } = adapter;
	if (info.isFallbackAdapter ?? adapter.isFallbackAdapter) {
		return "fallback adapter";
	}
	const m = /llvmpipe|lavapipe|swiftshader|microsoft basic render/i.exec(
		describeAdapter(info),
	);
	return m ? m[0].toLowerCase() : null;
}
