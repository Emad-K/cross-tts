import { expect, mock, test } from "bun:test";

/** Fake runtime: the first instance's first stream dies like a crashed worker. */
let loads = 0;
class FakePhonon {
	threads = 1;
	private failNext: boolean;
	constructor(fail: boolean) {
		this.failNext = fail;
	}
	static async load() {
		loads++;
		return new FakePhonon(loads === 1);
	}
	stream() {
		const fail = this.failNext;
		this.failNext = false;
		return {
			cancel() {},
			async *[Symbol.asyncIterator]() {
				if (fail) throw new Error("phonon-tts worker failed: boom");
				yield new Float32Array(2400).fill(0.1);
			},
		};
	}
	dispose() {}
}

mock.module("phonon-tts", () => ({ PhononTTS: FakePhonon }));
mock.module("@/lib/desktopBridge", () => ({
	getKokoroHubBaseUrl: async () => null,
	isDesktopApp: () => false,
}));
mock.module("../logging", () => ({ logError() {}, logInfo() {}, logWarn() {} }));
mock.module("./ttsStore", () => ({
	useTtsStore: {
		getState: () => ({ speed: 1, setModelPhase() {}, setModelProgress() {} }),
	},
}));

const { phononEngine } = await import("./phononEngine");
const { SynthCore } = await import("./synthCore");

test("a crashed worker restarts once and both the failed and the queued job retry", async () => {
	const core = new SynthCore<Float32Array>({
		engine: () => phononEngine,
		prefs: () => ({ gpu: false, gpuPower: "auto", cpuThreads: 1 }),
		rulesSignature: () => "",
		prepareText: (t) => t,
	});
	await phononEngine.ensureLoaded({ gpu: false, gpuPower: "auto", cpuThreads: 1 });
	// The second is queued behind the first, as a playback prefetch would be.
	const [a, b] = await Promise.all([
		core.generate("Hello there.", "default", 1),
		core.generate("General Kenobi.", "default", 1),
	]);
	expect(a?.length).toBe(2400);
	expect(b?.length).toBe(2400);
	expect(loads).toBe(2);
});
