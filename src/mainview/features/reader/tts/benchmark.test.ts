import { describe, expect, test } from "bun:test";
import type { BackendAvailability } from "@shared/appConfig";
import type { RunningBackend } from "./backendChoice";
import {
	type BenchmarkRow,
	benchmarkCandidates,
	fasterChoice,
	fastestBackend,
	isBenchmarkRunning,
	runBenchmark,
	stopBenchmark,
} from "./benchmark";
import type { TtsBackendPrefs, TtsEngine } from "./ttsEngineTypes";

/** A clock the fake engine advances, so timings are exact. */
function fakeEngine(cost: Partial<Record<RunningBackend, { load: number; synth: number }>>) {
	let clock = 0;
	let loaded: RunningBackend | null = null;
	const log: string[] = [];
	const engine: TtsEngine = {
		id: "kokoro",
		displayName: "Fake",
		licence: { name: "", url: "" },
		languages: [],
		sampleRate: 1000,
		defaultVoice: "v",
		listVoices: () => [],
		async ensureLoaded(prefs: TtsBackendPrefs) {
			const want = prefs.backend as RunningBackend;
			if (want === "dml") throw new Error("no such provider");
			// CUDA "falls back" to the CPU, like the native engine does.
			loaded = cost[want] ? want : "cpu";
			clock += cost[loaded]?.load ?? 0;
			log.push(`load ${want}`);
		},
		activeBackend: () => loaded,
		runningOn: () => loaded,
		async synthesize() {
			if (!loaded) throw new Error("TTS engine reset");
			clock += cost[loaded]!.synth;
			return new Float32Array(4000); // 4 s of audio
		},
		dispose() {
			loaded = null;
			log.push("dispose");
		},
		onReset: null,
	};
	return { engine, log, now: () => clock };
}

const prefs = (backend: RunningBackend): TtsBackendPrefs => ({
	backend,
	noFallback: true,
	gpuPower: "auto",
	cpuThreads: 4,
	gpuFp16: false,
});

describe("runBenchmark", () => {
	test("times each backend and reports skips and fallbacks", async () => {
		const { engine, log, now } = fakeEngine({
			webgpu: { load: 900, synth: 500 },
			cpu: { load: 1000, synth: 2000 },
		});
		const rows: BenchmarkRow[] = [];
		await runBenchmark({
			engine,
			candidates: [
				{ backend: "webgpu" },
				{ backend: "cuda" },
				{ backend: "dml" },
				{ backend: "cpu" },
				{ backend: "wasm", skip: "skipped: not downloaded" },
			],
			prefs,
			voice: "v",
			signal: new AbortController().signal,
			onRow: (row) => {
				expect(isBenchmarkRunning()).toBe(true);
				rows.push(row);
			},
			now,
		});
		expect(rows).toEqual([
			{ backend: "webgpu", loadMs: 900, firstMs: 500, realtime: 8 },
			{ backend: "cuda", note: "couldn't start" },
			{ backend: "dml", note: "couldn't start" },
			{ backend: "cpu", loadMs: 1000, firstMs: 2000, realtime: 2 },
			{ backend: "wasm", note: "skipped: not downloaded" },
		]);
		// The skipped backend was never loaded, and the engine ends unloaded.
		expect(log.filter((l) => l.startsWith("load"))).not.toContain("load wasm");
		expect(log.at(-1)).toBe("dispose");
		expect(isBenchmarkRunning()).toBe(false);
		expect(fastestBackend(rows)).toBe("webgpu");
	});

	test("cancel unloads the engine and stops", async () => {
		const { engine, now } = fakeEngine({ cpu: { load: 1, synth: 1 }, wasm: { load: 1, synth: 1 } });
		const abort = new AbortController();
		const rows: BenchmarkRow[] = [];
		const synthesize = engine.synthesize.bind(engine);
		engine.synthesize = async (...args) => {
			abort.abort(); // cancelled mid-sentence: dispose makes this run fail
			return synthesize(...args);
		};
		await runBenchmark({
			engine,
			candidates: [{ backend: "cpu" }, { backend: "wasm" }],
			prefs,
			voice: "v",
			signal: abort.signal,
			onRow: (row) => rows.push(row),
			now,
		});
		expect(rows).toEqual([]);
		expect(engine.activeBackend()).toBeNull();
		expect(isBenchmarkRunning()).toBe(false);
	});

	test("a reset from outside stops it without a false \"couldn't start\"", async () => {
		const { engine, now } = fakeEngine({ cpu: { load: 1, synth: 1 }, wasm: { load: 1, synth: 1 } });
		const rows: BenchmarkRow[] = [];
		const synthesize = engine.synthesize.bind(engine);
		engine.synthesize = async (...args) => {
			// What resetTtsEngine does when a setting changes mid-run.
			if (rows.length === 1) stopBenchmark();
			return synthesize(...args);
		};
		const finished = await runBenchmark({
			engine,
			candidates: [{ backend: "cpu" }, { backend: "wasm" }],
			prefs,
			voice: "v",
			signal: new AbortController().signal,
			onRow: (row) => rows.push(row),
			now,
		});
		expect(finished).toBe(false);
		expect(rows.map((r) => r.backend)).toEqual(["cpu"]);
		expect(rows[0]!.note).toBeUndefined();
		expect(isBenchmarkRunning()).toBe(false);
	});
});

describe("fasterChoice", () => {
	const rows: BenchmarkRow[] = [
		{ backend: "webgpu", realtime: 9 },
		{ backend: "cuda", note: "couldn't start" },
		{ backend: "cpu", realtime: 4 },
		{ backend: "wasm", realtime: 1 },
	];
	test("nothing to offer when the current choice already runs the fastest", () => {
		expect(fasterChoice("kokoro", "auto", rows)).toBeNull();
		expect(fasterChoice("kokoro", "webgpu", rows)).toBeNull();
	});
	test("offers the fastest when the current choice runs something slower", () => {
		expect(fasterChoice("kokoro", "cpu", rows)).toBe("webgpu");
		// CUDA couldn't start, so that choice really runs on the native CPU.
		expect(fasterChoice("kokoro", "cuda", rows)).toBe("webgpu");
		// Supertonic's Auto prefers the native CPU.
		expect(fasterChoice("supertonic", "auto", rows)).toBe("webgpu");
	});
	test("no measurements, no suggestion", () => {
		expect(fastestBackend([{ backend: "cpu", note: "couldn't start" }])).toBeNull();
		expect(fasterChoice("kokoro", "auto", [])).toBeNull();
	});
});

describe("benchmarkCandidates", () => {
	const backends: BackendAvailability = { native: true, dml: false, cuda: "unavailable" };
	const all = { webgpu: true, backends, fp32: true, q8: true, supertonic: true };
	test("Kokoro: what this machine has; missing downloads are skipped, not fetched", () => {
		expect(benchmarkCandidates("kokoro", all)).toEqual([
			{ backend: "webgpu" },
			{ backend: "cpu" },
			{ backend: "wasm" },
		]);
		expect(
			benchmarkCandidates("kokoro", {
				...all,
				webgpu: false,
				q8: false,
				backends: { native: true, dml: true, cuda: "needs-addon" },
			}),
		).toEqual([
			{ backend: "cuda", skip: "skipped: add-on not installed" },
			{ backend: "dml" },
			{ backend: "cpu" },
			{ backend: "wasm", skip: "skipped: not downloaded" },
		]);
	});
	test("Supertonic has no CUDA/DirectML; Phonon has nothing to compare", () => {
		const gpu = { ...all, backends: { native: true, dml: true, cuda: "ready" as const } };
		expect(benchmarkCandidates("supertonic", gpu).map((c) => c.backend)).toEqual([
			"webgpu",
			"cpu",
			"wasm",
		]);
		expect(benchmarkCandidates("supertonic", { ...gpu, supertonic: false })[0]).toEqual({
			backend: "webgpu",
			skip: "skipped: not downloaded",
		});
		expect(benchmarkCandidates("phonon", all)).toEqual([]);
	});
});
