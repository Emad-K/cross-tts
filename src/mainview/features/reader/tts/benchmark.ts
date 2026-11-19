import type { BackendAvailability } from "@shared/appConfig";
import { loadPlan, type RunningBackend } from "./backendChoice";
import type { TtsBackendPrefs, TtsEngine } from "./ttsEngineTypes";

/**
 * The user-run backend benchmark (Settings → Performance): load the current
 * engine on each backend this machine has, read one sentence twice, and
 * report load time, first-sentence time and speed. Never runs on its own and
 * never changes a setting. No store or DOM access, so a fake engine can
 * drive it in tests.
 */

/** About 150 characters: a typical sentence-sized chunk. */
export const BENCHMARK_TEXT =
	"The old lighthouse keeper climbed the winding stairs every evening, lit the great lamp, and watched the ships find their way safely past the rocks.";

export type BenchmarkCandidate = {
	backend: RunningBackend;
	/** Set when the backend can't be measured without a download. */
	skip?: string;
};

export type BenchmarkRow = {
	backend: RunningBackend;
	/** Why there are no timings ("skipped: …", "couldn't start"). */
	note?: string;
	loadMs?: number;
	/** First sentence after the load (includes warm-up). */
	firstMs?: number;
	/** Seconds of audio per second of work, on the second run. */
	realtime?: number;
};

/**
 * Backends worth measuring for an engine on this machine. Ones whose model
 * (or the CUDA add-on) isn't on disk are listed as skipped: the benchmark
 * must never start a download.
 */
export function benchmarkCandidates(
	engineId: string,
	have: {
		webgpu: boolean;
		backends: BackendAvailability;
		/** Model files on disk: Kokoro fp32, Kokoro q8, Supertonic. */
		fp32: boolean;
		q8: boolean;
		supertonic: boolean;
	},
): BenchmarkCandidate[] {
	const NOT_DOWNLOADED = "skipped: not downloaded";
	const on = (backend: RunningBackend, model: boolean): BenchmarkCandidate =>
		model ? { backend } : { backend, skip: NOT_DOWNLOADED };
	const out: BenchmarkCandidate[] = [];
	if (engineId === "supertonic") {
		if (have.webgpu) out.push(on("webgpu", have.supertonic));
		if (have.backends.native) out.push(on("cpu", have.supertonic));
		out.push(on("wasm", have.supertonic));
	} else if (engineId === "kokoro") {
		if (have.webgpu) out.push(on("webgpu", have.fp32));
		if (have.backends.cuda === "needs-addon") {
			out.push({ backend: "cuda", skip: "skipped: add-on not installed" });
		} else if (have.backends.cuda === "ready") {
			out.push(on("cuda", have.fp32));
		}
		if (have.backends.dml) out.push(on("dml", have.fp32));
		if (have.backends.native) out.push(on("cpu", have.fp32));
		out.push(on("wasm", have.q8));
	}
	return out;
}

/** Stops the benchmark in progress, if any. */
let stop: (() => void) | null = null;

/** True while a benchmark owns the engine; playback must not start then. */
export function isBenchmarkRunning(): boolean {
	return stop !== null;
}

/**
 * End a running benchmark early. Called before anything else unloads the
 * engine (a changed setting, a deleted model): otherwise the backend being
 * measured would fail and be reported as "couldn't start".
 */
export function stopBenchmark(): void {
	stop?.();
}

/**
 * Measure each candidate in turn. `onRow` gets every finished row. Aborting
 * `signal` (or stopBenchmark) unloads the engine at once, which fails
 * whatever is in flight. The engine is left unloaded. Resolves true when
 * every candidate was handled, false when it was stopped early.
 */
export async function runBenchmark(opts: {
	engine: TtsEngine;
	candidates: readonly BenchmarkCandidate[];
	/** Hardware prefs that load `backend` and nothing else (noFallback). */
	prefs: (backend: RunningBackend) => TtsBackendPrefs;
	voice: string;
	signal: AbortSignal;
	onRow: (row: BenchmarkRow) => void;
	now?: () => number;
}): Promise<boolean> {
	const { engine, signal } = opts;
	const now = opts.now ?? (() => performance.now());
	let stopped = signal.aborted;
	const cancel = () => {
		stopped = true;
		engine.dispose();
	};
	signal.addEventListener("abort", cancel);
	stop = cancel;
	try {
		for (const { backend, skip } of opts.candidates) {
			if (stopped) return false;
			if (skip) {
				opts.onRow({ backend, note: skip });
				continue;
			}
			engine.dispose();
			try {
				let t = now();
				await engine.ensureLoaded(opts.prefs(backend));
				const loadMs = now() - t;
				// Loaded, but on a fallback: timing that would mislabel it.
				if (engine.runningOn?.() !== backend) {
					opts.onRow({ backend, note: "couldn't start" });
					continue;
				}
				t = now();
				await engine.synthesize(BENCHMARK_TEXT, opts.voice, 1, {});
				const firstMs = now() - t;
				t = now();
				const pcm = await engine.synthesize(BENCHMARK_TEXT, opts.voice, 1, {});
				const secondMs = now() - t;
				// A GPU run can fail over to the CPU mid-way (out of memory).
				if (!pcm || engine.runningOn?.() !== backend) {
					opts.onRow({ backend, note: "couldn't start" });
					continue;
				}
				opts.onRow({
					backend,
					loadMs,
					firstMs,
					realtime: pcm.length / engine.sampleRate / (Math.max(secondMs, 1) / 1000),
				});
			} catch {
				if (stopped) return false;
				opts.onRow({ backend, note: "couldn't start" });
			}
		}
		return !stopped;
	} finally {
		stop = null;
		signal.removeEventListener("abort", cancel);
		engine.dispose();
	}
}

/** The backend with the highest speed, or null when nothing was measured. */
export function fastestBackend(rows: readonly BenchmarkRow[]): RunningBackend | null {
	let best: BenchmarkRow | null = null;
	for (const row of rows) {
		if (row.realtime !== undefined && row.realtime > (best?.realtime ?? 0)) best = row;
	}
	return best?.backend ?? null;
}

/**
 * The fastest measured backend when picking it would change what runs, else
 * null: no "Use fastest" when the current choice already lands on it (e.g.
 * Auto on a machine where WebGPU won).
 */
export function fasterChoice(
	engineId: string,
	current: Parameters<typeof loadPlan>[1],
	rows: readonly BenchmarkRow[],
): RunningBackend | null {
	const fastest = fastestBackend(rows);
	const measured = new Set(rows.filter((r) => r.realtime !== undefined).map((r) => r.backend));
	const currentRunsOn = loadPlan(engineId, current).find((b) => measured.has(b));
	return fastest && fastest !== currentRunsOn ? fastest : null;
}
