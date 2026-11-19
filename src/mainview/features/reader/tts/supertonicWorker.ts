/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/webgpu";
import ortMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { CANCELLED, SynthJobQueue } from "./synthJobQueue";
import {
	loadSupertonicAssets,
	runSupertonicJob,
	SUPERTONIC_ONNX,
	SUPERTONIC_ONNX_BYTES,
	SUPERTONIC_SAMPLE_RATE,
	supertonicFileUrl,
	type OrtTensorCtor,
	type SupertonicJob,
	type SupertonicRuntime,
	type SupertonicSessions,
} from "./supertonicModel";

/**
 * Supertonic 3 on onnxruntime-web (WebGPU, else multi-threaded WASM), off the
 * renderer's main thread. Mirrors ttsWorker.ts (Kokoro): one job at a time,
 * stale playback jobs dropped, GPU errors surfaced instead of odd audio.
 */

type InitMessage = {
	type: "init";
	hubBaseUrl: string;
	device: "webgpu" | "wasm";
	numThreads: number;
};
type GenerateMessage = { type: "generate"; id: number; epoch?: number } & SupertonicJob;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Same offline setup as ttsWorker.ts: ORT's wasm glue and binary come from the
// app bundle (not a CDN), as separate files the CSP allows.
ort.env.wasm.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl };

let runtime: SupertonicRuntime | null = null;
let loadPromise: Promise<void> | null = null;
let gpuDevice: GPUDevice | null = null;
let gpuLostReason: string | null = null;

/**
 * Fetch a model graph, reporting bytes towards the whole model's size. Chunks
 * go straight into one buffer sized from Content-Length (the hub always sends
 * it), so the 257 MB vector estimator is never held twice before ORT copies it.
 */
async function fetchGraph(url: string, onBytes: (n: number) => void): Promise<Uint8Array> {
	const res = await fetch(url);
	if (!res.ok || !res.body) throw new Error(`Failed to fetch ${url}: ${res.status}`);
	const size = Number(res.headers.get("Content-Length"));
	if (!(size > 0)) {
		const bytes = new Uint8Array(await res.arrayBuffer());
		onBytes(bytes.length);
		return bytes;
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	const reader = res.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (offset + value.length > size) throw new Error(`${url} is larger than its Content-Length`);
		bytes.set(value, offset);
		offset += value.length;
		onBytes(value.length);
	}
	if (offset !== size) throw new Error(`${url} ended after ${offset} of ${size} bytes`);
	return bytes;
}

async function load(init: InitMessage): Promise<void> {
	const url = (file: string) => supertonicFileUrl(init.hubBaseUrl, file);
	if (init.device === "wasm") ort.env.wasm.numThreads = init.numThreads;
	const options = {
		executionProviders: [init.device],
		graphOptimizationLevel: "all" as const,
	};
	const assets = await loadSupertonicAssets(async (file) => {
		const res = await fetch(url(file));
		if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status}`);
		return res.text();
	});
	let loaded = 0;
	const sessions: Partial<SupertonicSessions> = {};
	// One graph at a time: the 257 MB vector estimator alone is a lot of memory.
	for (const [key, file] of Object.entries(SUPERTONIC_ONNX)) {
		const bytes = await fetchGraph(url(file), (n) => {
			loaded += n;
			ctx.postMessage({ type: "progress", value: Math.min(1, loaded / SUPERTONIC_ONNX_BYTES) });
		});
		sessions[key as keyof SupertonicSessions] = await ort.InferenceSession.create(bytes, options);
	}
	if (init.device === "webgpu") {
		const dev = await ort.env.webgpu.device;
		gpuDevice = dev ?? null;
		void dev?.lost.then((info) => {
			gpuLostReason = info.message || info.reason || "unknown";
		});
	}
	runtime = {
		Tensor: ort.Tensor as unknown as OrtTensorCtor,
		sessions: sessions as SupertonicSessions,
		assets,
	};
}

/**
 * One request with GPU errors made visible: ORT-web only logs validation
 * errors and drops out-of-memory ones (see ttsWorker.ts), so error scopes
 * wrap the whole run; jobs are serialized, so scopes never overlap.
 */
async function runJob(rt: SupertonicRuntime, msg: GenerateMessage) {
	const stale = () => jobs.yieldAndCheckStale(msg);
	const dev = gpuDevice;
	if (!dev) return runSupertonicJob(rt, msg, stale);
	if (gpuLostReason) throw new Error(`gpu-fault: device lost (${gpuLostReason})`);
	dev.pushErrorScope("out-of-memory");
	dev.pushErrorScope("validation");
	let result: Awaited<ReturnType<typeof runSupertonicJob>> | null = null;
	let runError: unknown = null;
	try {
		result = await runSupertonicJob(rt, msg, stale);
	} catch (e) {
		runError = e;
	}
	const [validation, oom] = await Promise.all([
		dev.popErrorScope().catch(() => null),
		dev.popErrorScope().catch(() => null),
	]);
	if (runError) throw runError;
	const fault = oom ?? validation;
	if (fault) throw new Error(`gpu-fault: ${fault.message}`);
	if (gpuLostReason) throw new Error(`gpu-fault: device lost (${gpuLostReason})`);
	return result!;
}

const jobs = new SynthJobQueue<GenerateMessage>(async (msg) => {
	const startedAt = performance.now();
	try {
		if (jobs.isStale(msg)) {
			ctx.postMessage({ type: "result", id: msg.id, error: CANCELLED });
			return;
		}
		if (!runtime) {
			ctx.postMessage({ type: "result", id: msg.id, error: "Model not loaded" });
			return;
		}
		const { audio, empty, error } = await runJob(runtime, msg);
		if (!audio) {
			ctx.postMessage({ type: "result", id: msg.id, error, empty });
			return;
		}
		ctx.postMessage(
			{
				type: "result",
				id: msg.id,
				audio,
				samplingRate: SUPERTONIC_SAMPLE_RATE,
				synthMs: Math.round(performance.now() - startedAt),
			},
			[audio.buffer],
		);
	} catch (e) {
		ctx.postMessage({
			type: "result",
			id: msg.id,
			error: e instanceof Error ? e.message : String(e),
		});
	}
});

ctx.onmessage = (event: MessageEvent<InitMessage | GenerateMessage>) => {
	const msg = event.data;
	if (msg.type === "generate") {
		jobs.push(msg);
		return;
	}
	const startedAt = performance.now();
	loadPromise ??= load(msg).catch((e) => {
		loadPromise = null;
		throw e;
	});
	void loadPromise
		.then(() =>
			ctx.postMessage({ type: "ready", loadMs: Math.round(performance.now() - startedAt) }),
		)
		.catch((e: unknown) =>
			ctx.postMessage({
				type: "initError",
				message: e instanceof Error ? e.message : String(e),
			}),
		);
};
