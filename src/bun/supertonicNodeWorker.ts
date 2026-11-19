import { createRequire } from "node:module";
import { join } from "node:path";
import {
	CANCELLED,
	SynthJobQueue,
} from "../mainview/features/reader/tts/synthJobQueue";
import {
	loadSupertonicAssets,
	runSupertonicJob,
	SUPERTONIC_ONNX,
	SUPERTONIC_ONNX_BYTES,
	SUPERTONIC_SAMPLE_RATE,
	supertonicFileUrl,
	supertonicRepoPath,
	type OrtSessionLike,
	type OrtTensorCtor,
	type SupertonicJob,
	type SupertonicRuntime,
	type SupertonicSessions,
} from "../mainview/features/reader/tts/supertonicModel";
import { isUsableCachedFile } from "./hubDiskCache";

/**
 * Native CPU backend for Supertonic 3: an Electron utility process running
 * the four graphs on onnxruntime-node. Same protocol as ttsNodeWorker.ts
 * (Kokoro): init → ready/initError, generate → result, one job at a time,
 * stale playback jobs dropped.
 */

type InitMessage = {
	type: "init";
	hubBaseUrl: string;
	hubCacheDir: string;
	numThreads: number;
};
type GenerateJob = { type: "generate"; id: number; epoch?: number } & SupertonicJob;

type OrtNode = {
	Tensor: OrtTensorCtor;
	InferenceSession: {
		create(path: string, options: object): Promise<OrtSessionLike>;
	};
};

// onnxruntime-node is transformers.js's dependency, not ours: resolve it from
// there (as cudaSupport.ts does) so both engines run the one copy we ship.
const ort = createRequire(require.resolve("@huggingface/transformers"))(
	"onnxruntime-node",
) as OrtNode;

const parentPort = process.parentPort;
let runtime: SupertonicRuntime | null = null;
let loadPromise: Promise<void> | null = null;

/**
 * Make sure the hub has a graph on disk (downloading and verifying it on a
 * miss) and return its path; ORT reads it from there, so the weights are
 * never held twice.
 */
async function graphOnDisk(
	init: InitMessage,
	file: string,
	onBytes: (n: number) => void,
): Promise<string> {
	const path = join(init.hubCacheDir, ...supertonicRepoPath(file).split("/"));
	if (isUsableCachedFile(path)) {
		onBytes(0);
		return path;
	}
	const res = await fetch(supertonicFileUrl(init.hubBaseUrl, file));
	if (!res.ok || !res.body) throw new Error(`Failed to fetch ${file}: ${res.status}`);
	const reader = res.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		onBytes(value.length);
	}
	if (!isUsableCachedFile(path)) throw new Error(`${file} missing after download`);
	return path;
}

async function load(init: InitMessage): Promise<void> {
	const options = {
		graphOptimizationLevel: "all",
		...(init.numThreads > 0 ? { intraOpNumThreads: init.numThreads } : {}),
	};
	const assets = await loadSupertonicAssets(async (file) => {
		const res = await fetch(supertonicFileUrl(init.hubBaseUrl, file));
		if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status}`);
		return res.text();
	});
	let loaded = 0;
	const sessions: Partial<SupertonicSessions> = {};
	for (const [key, file] of Object.entries(SUPERTONIC_ONNX)) {
		const path = await graphOnDisk(init, file, (n) => {
			loaded += n;
			parentPort.postMessage({
				type: "progress",
				value: Math.min(1, loaded / SUPERTONIC_ONNX_BYTES),
			});
		});
		sessions[key as keyof SupertonicSessions] = await ort.InferenceSession.create(
			path,
			options,
		);
	}
	runtime = { Tensor: ort.Tensor, sessions: sessions as SupertonicSessions, assets };
}

/** See ttsNodeWorker.ts: inference blocks the event loop, so yield fully. */
const yieldToMessages = () =>
	new Promise<void>((r) => setTimeout(r, 0)).then(
		() => new Promise<void>((r) => setImmediate(r)),
	);

const jobs = new SynthJobQueue<GenerateJob>(async (msg) => {
	const startedAt = performance.now();
	try {
		if (jobs.isStale(msg)) {
			parentPort.postMessage({ type: "result", id: msg.id, error: CANCELLED });
			return;
		}
		if (!runtime) {
			parentPort.postMessage({ type: "result", id: msg.id, error: "Model not loaded" });
			return;
		}
		const { audio, empty, error } = await runSupertonicJob(runtime, msg, () =>
			jobs.yieldAndCheckStale(msg),
		);
		parentPort.postMessage(
			audio
				? {
						type: "result",
						id: msg.id,
						audio,
						samplingRate: SUPERTONIC_SAMPLE_RATE,
						synthMs: Math.round(performance.now() - startedAt),
					}
				: { type: "result", id: msg.id, error, empty },
		);
	} catch (e) {
		parentPort.postMessage({
			type: "result",
			id: msg.id,
			error: e instanceof Error ? e.message : String(e),
		});
	}
}, yieldToMessages);

parentPort.on("message", (event) => {
	const msg = event.data as InitMessage | GenerateJob;
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
			parentPort.postMessage({
				type: "ready",
				voices: [],
				loadMs: Math.round(performance.now() - startedAt),
			}),
		)
		.catch((e: unknown) =>
			parentPort.postMessage({
				type: "initError",
				message: e instanceof Error ? e.message : String(e),
			}),
		);
});
