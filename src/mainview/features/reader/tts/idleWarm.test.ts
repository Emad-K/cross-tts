import { describe, expect, test } from "bun:test";
import { splitForFastStart } from "./chunkText";
import { createIdleWarmer, idleWarmKey } from "./idleWarm";
import { SynthCore } from "./synthCore";
import type { TtsEngine } from "./ttsEngineTypes";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base = {
	modelPhase: "ready" as const,
	playback: "idle" as const,
	engineId: "kokoro",
	voice: "af_heart",
	speed: 1,
	supertonicSteps: 5,
	chunks: [{ text: "One." }, { text: "Two." }],
	currentChunkIndex: 0,
};

describe("idleWarmKey", () => {
	test("is null unless a model is loaded and playback is idle or paused", () => {
		expect(idleWarmKey(base)).not.toBeNull();
		expect(idleWarmKey({ ...base, playback: "paused" })).not.toBeNull();
		for (const modelPhase of ["idle", "loading", "error"] as const) {
			expect(idleWarmKey({ ...base, modelPhase })).toBeNull();
		}
		for (const playback of ["playing", "buffering", "loading_model"] as const) {
			expect(idleWarmKey({ ...base, playback })).toBeNull();
		}
		expect(idleWarmKey({ ...base, chunks: [] })).toBeNull();
	});

	test("changes with position, text, voice, speed, engine and steps", () => {
		const keys = [
			base,
			{ ...base, currentChunkIndex: 1 },
			{ ...base, chunks: [{ text: "Other." }] },
			{ ...base, voice: "bm_george" },
			{ ...base, speed: 1.25 },
			{ ...base, engineId: "supertonic" },
			{ ...base, supertonicSteps: 8 },
		].map(idleWarmKey);
		expect(new Set(keys).size).toBe(keys.length);
		expect(idleWarmKey({ ...base })).toBe(keys[0]!);
	});
});

describe("createIdleWarmer", () => {
	test("warms once after the key settles", async () => {
		let runs = 0;
		const update = createIdleWarmer(() => runs++, 20);
		update("a");
		update("b");
		update("b"); // unrelated store update: must not push the timer back
		await sleep(10);
		update("b");
		expect(runs).toBe(0);
		await sleep(25);
		expect(runs).toBe(1);
		update("b");
		await sleep(30);
		expect(runs).toBe(1);
	});

	test("null cancels a pending run and lets the same key warm again", async () => {
		let runs = 0;
		const update = createIdleWarmer(() => runs++, 20);
		update("a");
		update(null); // play pressed before the delay passed
		await sleep(30);
		expect(runs).toBe(0);
		update("a"); // stopped again at the same place
		await sleep(30);
		expect(runs).toBe(1);
	});
});

/** A fake engine that records what it was asked to speak. */
function fakeEngine() {
	const spoken: string[] = [];
	const engine: TtsEngine = {
		id: "fake",
		displayName: "Fake",
		licence: { name: "MIT", url: "" },
		languages: ["en-us"],
		sampleRate: 24_000,
		defaultVoice: "v1",
		listVoices: () => [],
		ensureLoaded: async () => {},
		activeBackend: () => "cpu",
		async synthesize(text) {
			spoken.push(text);
			return new Float32Array(8);
		},
		dispose() {},
		onReset: null,
	};
	return { engine, spoken };
}

test("play after a warm-up finds both fast-start parts in the cache", async () => {
	const { engine, spoken } = fakeEngine();
	const core = new SynthCore<Float32Array>({
		engine: () => engine,
		prefs: () => ({ gpu: false, gpuPower: "auto", cpuThreads: 1, gpuFp16: false }),
		rulesSignature: () => "",
		prepareText: (t) => t,
	});
	const chunk =
		"The fast start splits a long sentence at its first clause, which is here, " +
		"and the warm-up must split it at exactly the same place, or pressing play " +
		"would miss the cache and synthesize the same words a second time.";
	const parts = splitForFastStart(chunk);
	expect(parts.length).toBe(2);

	// Warm-up: both parts, under the idle epoch.
	await Promise.all(parts.map((p) => core.get(p, "v1", 1, (pcm) => pcm)));
	expect(spoken).toEqual(parts);

	// Play: a new epoch, the whole chunk is not cached, so the loop takes the
	// fast-start path and asks for the same two parts.
	core.epoch++;
	expect(core.has(chunk, "v1", 1)).toBe(false);
	expect(parts.every((p) => core.has(p, "v1", 1))).toBe(true);
	await Promise.all(parts.map((p) => core.get(p, "v1", 1, (pcm) => pcm)));
	expect(spoken).toEqual(parts);
});
