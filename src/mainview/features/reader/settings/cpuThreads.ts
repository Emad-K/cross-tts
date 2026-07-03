/**
 * WASM (ORT) thread-count policy, pure and bun-testable.
 *
 * Auto mode deliberately caps low: onnxruntime-web's own default is
 * min(4, ceil(cores/2)) because an 82M-parameter model's small ops gain
 * nothing past a few threads — 15 threads on a 16-core box adds contention
 * and is often *slower* than 4. The user can still raise it via the slider.
 */
export function maxSelectableCpuThreads(cores: number): number {
	return Math.max(1, (cores || 2) - 1);
}

export function autoCpuThreads(cores: number): number {
	return Math.min(4, maxSelectableCpuThreads(cores));
}
