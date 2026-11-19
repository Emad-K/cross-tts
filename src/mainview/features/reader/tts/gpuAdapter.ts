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
 * Why `info` is a software rasterizer rather than a GPU (fallback adapter,
 * Mesa llvmpipe/lavapipe, SwiftShader), or null for a real GPU. Running the
 * model there is slower than the CPU backends, so it counts as "no GPU".
 */
export function softwareAdapterReason(info: AdapterInfo): string | null {
	if (info.isFallbackAdapter) return "fallback adapter";
	const m = /llvmpipe|lavapipe|swiftshader/i.exec(describeAdapter(info));
	return m ? m[0].toLowerCase() : null;
}
