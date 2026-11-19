import { describe, expect, test } from "bun:test";
import { SynthCore } from "./synthCore";
import { CANCELLED } from "./synthJobQueue";
import type { TtsEngine } from "./ttsEngineTypes";

type Call = { text: string; voice: string; epoch?: number; backend: string };

/** A fake engine: after faultGpu(), "gpu" fails until recovered to "cpu"; jobs settle by hand. */
function fakeEngine(id: string) {
	const calls: Call[] = [];
	const settle: ((r: Float32Array | Error) => void)[] = [];
	let backend: string | null = "cpu";
	let loads = 0;
	const engine: TtsEngine = {
		id,
		displayName: id,
		licence: { name: "MIT", url: "" },
		languages: ["en-us"],
		sampleRate: 24_000,
		defaultVoice: "v1",
		listVoices: () => [{ id: "v1", label: "V1", language: "en-us" }],
		async ensureLoaded() {
			loads++;
			backend ??= "cpu";
		},
		activeBackend: () => backend,
		synthesize(text, voice, _speed, { epoch }) {
			calls.push({ text, voice, epoch, backend: backend ?? "none" });
			if (backend === "gpu") return Promise.reject(new Error("gpu-fault: oom"));
			return new Promise((resolve, reject) =>
				settle.push((r) => (r instanceof Error ? reject(r) : resolve(r))),
			);
		},
		recover(failed, message) {
			if (failed !== "gpu" || !message.startsWith("gpu-fault")) return false;
			backend = null;
			engine.onReset?.();
			return true;
		},
		dispose() {
			backend = null;
		},
		onReset: null,
	};
	const faultGpu = () => {
		backend = "gpu";
	};
	return { engine, calls, settle, loads: () => loads, faultGpu };
}

function coreFor(getEngine: () => TtsEngine) {
	return new SynthCore<Float32Array>({
		engine: getEngine,
		prefs: () => ({ gpu: true, gpuPower: "auto", cpuThreads: 1 }),
		rulesSignature: () => "sig",
		prepareText: (t) => t.toUpperCase(),
	});
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const pcm = (n: number) => new Float32Array(n);

describe("SynthCore with a fake engine", () => {
	test("caches per engine id, passing prepared text and the epoch", async () => {
		const a = fakeEngine("a");
		const b = fakeEngine("b");
		let current = a.engine;
		const core = coreFor(() => current);
		const first = core.get("hi", "v1", 1, (p) => p);
		await tick();
		a.settle[0]!(pcm(3));
		expect((await first)?.length).toBe(3);
		expect(a.calls).toEqual([
			{ text: "HI", voice: "v1", epoch: core.epoch, backend: "cpu" },
		]);
		// Cached: no second synthesis.
		expect(core.has("hi", "v1", 1)).toBe(true);
		await core.get("hi", "v1", 1, (p) => p);
		expect(a.calls.length).toBe(1);
		// Another engine misses the cache.
		current = b.engine;
		expect(core.has("hi", "v1", 1)).toBe(false);
		const other = core.get("hi", "v1", 1, (p) => p);
		await tick();
		b.settle[0]!(pcm(5));
		expect((await other)?.length).toBe(5);
		expect(core.key("hi", "v1", 1)).not.toBe(coreFor(() => a.engine).key("hi", "v1", 1));
	});

	test("an engine's cache tag (e.g. quality steps) is part of the key", () => {
		const a = fakeEngine("a");
		let tag = "8";
		a.engine.cacheTag = () => tag;
		const core = coreFor(() => a.engine);
		const before = core.key("hi", "v1", 1);
		tag = "4";
		expect(core.key("hi", "v1", 1)).not.toBe(before);
	});

	test("recovers from a backend fault, retries once, and drops cached audio", async () => {
		const f = fakeEngine("k");
		const core = coreFor(() => f.engine);
		core.clearOnReset([f.engine]);
		// Cache a chunk before the backend faults.
		const cached = core.get("a", "v1", 1, (p) => p);
		await tick();
		f.settle[0]!(pcm(1));
		await cached;
		expect(core.has("a", "v1", 1)).toBe(true);
		f.faultGpu();
		const out = core.get("x", "v1", 1, (p) => p);
		await tick();
		f.settle[1]!(pcm(2));
		expect((await out)?.length).toBe(2);
		expect(f.calls.map((c) => c.backend)).toEqual(["cpu", "gpu", "cpu"]);
		expect(f.loads()).toBe(1);
		// The fallback reset dropped audio made before the switch.
		expect(core.has("a", "v1", 1)).toBe(false);
		expect(core.has("x", "v1", 1)).toBe(true);
	});

	test("errors the engine can't recover from are thrown and not cached", async () => {
		const f = fakeEngine("k");
		const core = coreFor(() => f.engine);
		const out = core.generate("x", "v1", 1);
		await tick();
		f.settle[0]!(new Error("boom"));
		await expect(out).rejects.toThrow("boom");
		expect(f.loads()).toBe(0);
		expect(core.has("x", "v1", 1)).toBe(false);
	});

	test("a cancelled job is re-asked under the new epoch only if still wanted", async () => {
		const f = fakeEngine("k");
		const core = coreFor(() => f.engine);
		// Stale and no longer wanted: the cancellation surfaces, nothing cached.
		const dropped = core.get("a", "v1", 1, (p) => p);
		await tick();
		core.epoch++;
		f.settle[0]!(new Error(CANCELLED));
		await expect(dropped).rejects.toThrow(CANCELLED);
		expect(core.has("a", "v1", 1)).toBe(false);

		// Asked again after the epoch moved: retried under the new epoch.
		const old = core.epoch;
		const wanted = core.get("b", "v1", 1, (p) => p);
		await tick();
		core.epoch++;
		const again = core.get("b", "v1", 1, (p) => p);
		f.settle[1]!(new Error(CANCELLED));
		await tick();
		expect(f.calls.slice(1).map((c) => c.epoch)).toEqual([old, core.epoch]);
		f.settle[2]!(pcm(4));
		expect((await wanted)?.length).toBe(4);
		expect(await again).toBe(await wanted);
	});
});
