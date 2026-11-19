/// <reference lib="webworker" />
import { resampleSinc } from "@shared/resampleSinc";

/**
 * Resamples chunk PCM to the AudioContext rate off the UI thread (~75 ms per
 * 13 s chunk would otherwise be a long task on every sentence). Buffers move
 * by transfer both ways, never copied.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (
	event: MessageEvent<{ id: number; pcm: Float32Array; from: number; to: number }>,
) => {
	const { id, pcm, from, to } = event.data;
	try {
		const out = resampleSinc(pcm, from, to);
		ctx.postMessage({ id, out }, [out.buffer]);
	} catch (e) {
		ctx.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
	}
};
