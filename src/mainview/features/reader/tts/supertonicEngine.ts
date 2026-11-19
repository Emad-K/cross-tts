import licenceText from "../../../../../third_party/supertonic-3/LICENSE?raw";
import type { GpuPowerPreference } from "@shared/appConfig";
import {
	getKokoroHubBaseUrl,
	onTtsNodeProgress,
	ttsNodeGenerate,
	ttsNodeInit,
	ttsNodeStop,
} from "@/lib/desktopBridge";
import { logError, logInfo, logWarn } from "../logging";
import { softwareAdapterReason } from "./gpuAdapter";
import { SUPERTONIC_LANGS, SUPERTONIC_SAMPLE_RATE } from "./supertonicModel";
import {
	SUPERTONIC_DEFAULT_VOICE,
	supertonicVoiceOptions,
} from "./supertonicVoices";
import type {
	TtsBackendPrefs,
	TtsEngine,
	TtsSynthOptions,
} from "./ttsEngineTypes";
import { useTtsStore } from "./ttsStore";

/**
 * Supertonic 3 behind the TtsEngine interface. Backends, in preference order:
 * native onnxruntime-node utility process (src/bun/supertonicNodeWorker.ts;
 * measured ~7× realtime on an 8-core CPU) → WebGPU renderer worker → WASM
 * renderer worker (supertonicWorker.ts). Native comes first because it is
 * fast and verified; WebGPU serves where there's no native binding (Intel
 * Macs, web build). Both workers check the audio is plausible.
 */

type Backend = "node" | "webgpu" | "wasm";
type Result =
	| { kind: "audio"; audio: Float32Array; samplingRate: number; synthMs: number }
	| { kind: "empty" }
	| { kind: "error"; message: string };

const ENGINE_RESET = "TTS engine reset";
const ENGINE_TIMEOUT = "TTS engine timed out";
const NODE_DEAD_RE = /Native TTS (engine not running|process exited)/;
/** Same watchdog budget as Kokoro's worker requests. */
const WATCHDOG_BASE_MS = 60_000;
const WATCHDOG_MS_PER_CHAR = 500;

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let active: Backend | null = null;
/** Bumped by every teardown; a load from an older generation is stale. */
let loadGen = 0;
let gpuFailed = false;
/** Log the first synthesis after each load (warm-up, realtime factor). */
let loggedFirstSynth = false;
let reqSeq = 0;
let queuedChars = 0;
const pending = new Map<number, (r: Result) => void>();
let workerInit: { resolve: () => void; reject: (e: Error) => void } | null = null;

function teardown(reason = ENGINE_RESET): void {
	loadGen++;
	void ttsNodeStop("supertonic");
	workerInit?.reject(new Error(reason));
	workerInit = null;
	worker?.terminate();
	worker = null;
	ready = null;
	active = null;
	useTtsStore.getState().setModelPhase("idle");
	const toFail = [...pending.values()];
	pending.clear();
	for (const resolve of toFail) resolve({ kind: "error", message: reason });
	supertonicEngine.onReset?.();
}

function startWorker(
	device: "webgpu" | "wasm",
	hubBaseUrl: string,
	prefs: TtsBackendPrefs,
): Promise<void> {
	const w = new Worker(new URL("./supertonicWorker.ts", import.meta.url), {
		type: "module",
	});
	worker = w;
	const loaded = new Promise<void>((resolve, reject) => {
		workerInit = { resolve, reject };
	});
	w.onmessage = ({ data: msg }: MessageEvent) => {
		if (msg?.type === "progress") useTtsStore.getState().setModelProgress(msg.value);
		else if (msg?.type === "ready") workerInit?.resolve();
		else if (msg?.type === "initError") workerInit?.reject(new Error(msg.message));
		else if (msg?.type === "result") {
			const resolve = pending.get(msg.id);
			if (!resolve) return;
			pending.delete(msg.id);
			if (msg.error) resolve({ kind: "error", message: msg.error });
			else if (msg.empty) resolve({ kind: "empty" });
			else {
				resolve({
					kind: "audio",
					audio: msg.audio,
					samplingRate: msg.samplingRate,
					synthMs: msg.synthMs,
				});
			}
		}
	};
	w.onerror = (e) => {
		if (worker !== w) return;
		const message = e.message || "TTS worker crashed";
		if (!active) workerInit?.reject(new Error(message));
		else teardown(`TTS worker crashed: ${message}`);
	};
	w.postMessage({ type: "init", hubBaseUrl, device, numThreads: prefs.cpuThreads });
	return loaded;
}

/** A real GPU adapter (not SwiftShader/llvmpipe, which run slower than WASM). */
async function hasWebgpu(power: GpuPowerPreference): Promise<boolean> {
	try {
		const adapter = await navigator.gpu?.requestAdapter(
			power === "auto" ? undefined : { powerPreference: power },
		);
		return !!adapter && !softwareAdapterReason(adapter);
	} catch {
		return false;
	}
}

async function initNode(): Promise<boolean> {
	const unsubscribe = onTtsNodeProgress((v) =>
		useTtsStore.getState().setModelProgress(v),
	);
	try {
		const result = await ttsNodeInit("supertonic");
		if (result && !result.ok) {
			logWarn("Native Supertonic failed to start; using the in-app engine.", {
				source: "models",
				detail: result.error,
			});
		}
		return !!result?.ok;
	} finally {
		unsubscribe();
	}
}

function ensureLoaded(prefs: TtsBackendPrefs): Promise<void> {
	if (ready) return ready;
	const { setModelPhase, setModelProgress } = useTtsStore.getState();
	setModelPhase("loading");
	setModelProgress(0);
	const gen = loadGen;
	const checkCurrent = () => {
		if (gen !== loadGen) throw new Error(ENGINE_RESET);
	};
	const startedAt = performance.now();
	loggedFirstSynth = false;
	ready = (async () => {
		if (!useTtsStore.getState().licencesAccepted.includes(supertonicEngine.id)) {
			// Settings asks for the acknowledgement before this engine can be
			// picked; a book restored with it still mustn't download without it.
			throw new Error(
				"Accept the Supertonic 3 licence in Settings → Playback before its model is downloaded.",
			);
		}
		const hubBaseUrl = await getKokoroHubBaseUrl();
		checkCurrent();
		if (!hubBaseUrl) {
			// Only the hub verifies the pinned sha256s and keeps the ~400 MB on
			// disk; a plain HuggingFace fetch would do neither.
			throw new Error("Supertonic 3 needs the local model hub, which isn't running.");
		}
		logInfo("Loading Supertonic 3…", { source: "models" });
		let backend: Backend | null = (await initNode()) ? "node" : null;
		checkCurrent();
		if (!backend && prefs.gpu && !gpuFailed && (await hasWebgpu(prefs.gpuPower))) {
			try {
				await startWorker("webgpu", hubBaseUrl, prefs);
				backend = "webgpu";
			} catch (e) {
				checkCurrent();
				logWarn("Supertonic on the GPU failed to load; using the CPU.", {
					source: "models",
					detail: e instanceof Error ? e.message : String(e),
				});
				worker?.terminate();
				worker = null;
			}
		}
		checkCurrent();
		if (!backend) {
			await startWorker("wasm", hubBaseUrl, prefs);
			backend = "wasm";
		}
		checkCurrent();
		active = backend;
		setModelPhase("ready");
		setModelProgress(1);
		logInfo(
			`Supertonic 3 ready (${backend}) — loaded in ${((performance.now() - startedAt) / 1000).toFixed(1)}s.`,
			{ source: "models" },
		);
	})().catch((e: unknown) => {
		if (gen !== loadGen) throw e;
		const message = e instanceof Error ? e.message : String(e);
		teardown();
		setModelPhase("error", message);
		logError("Couldn't load Supertonic 3.", { source: "models", detail: message });
		throw e;
	});
	return ready;
}

function requestWorker(
	w: Worker,
	text: string,
	voice: string,
	speed: number,
	steps: number,
	epoch?: number,
): Promise<Result> {
	const id = ++reqSeq;
	return new Promise<Result>((resolve) => {
		const chars = text.length;
		queuedChars += chars;
		// A stalled GPU or silently killed worker never replies.
		const timer = setTimeout(
			() => {
				const finish = pending.get(id);
				if (!finish) return;
				pending.delete(id);
				finish({ kind: "error", message: ENGINE_TIMEOUT });
				if (worker === w) teardown(ENGINE_TIMEOUT);
			},
			WATCHDOG_BASE_MS + WATCHDOG_MS_PER_CHAR * queuedChars,
		);
		pending.set(id, (r) => {
			clearTimeout(timer);
			queuedChars -= chars;
			resolve(r);
		});
		w.postMessage({ type: "generate", id, text, voice, speed, steps, epoch });
	});
}

async function synthesize(
	text: string,
	voice: string,
	speed: number,
	opts: TtsSynthOptions,
): Promise<Float32Array | null> {
	const steps = useTtsStore.getState().supertonicSteps;
	let result: Result;
	if (active === "node") {
		result = (await ttsNodeGenerate({
			text,
			voice,
			speed,
			steps,
			pronunciationRules: [],
			epoch: opts.epoch,
		})) ?? { kind: "error", message: "Native TTS bridge unavailable" };
	} else if (worker && active) {
		result = await requestWorker(worker, text, voice, speed, steps, opts.epoch);
	} else {
		result = { kind: "error", message: "Engine not ready" };
	}
	if (result.kind === "error") throw new Error(result.message);
	if (result.kind === "empty") return null;
	if (result.samplingRate !== SUPERTONIC_SAMPLE_RATE) {
		throw new Error(
			`Supertonic returned ${result.samplingRate} Hz audio, expected ${SUPERTONIC_SAMPLE_RATE} Hz`,
		);
	}
	if (!loggedFirstSynth) {
		loggedFirstSynth = true;
		const audioSec = result.audio.length / SUPERTONIC_SAMPLE_RATE;
		logInfo(
			`First sentence synthesized in ${(result.synthMs / 1000).toFixed(2)}s ` +
				`(${audioSec.toFixed(1)}s of audio, ${(audioSec / (result.synthMs / 1000)).toFixed(1)}× realtime, ${steps} steps).`,
			{ source: "tts" },
		);
	}
	return result.audio;
}

/** GPU fault → CPU until settings change; dead native process → restart it. */
function recover(backend: string, message: string): boolean {
	const gpuFault = backend === "webgpu" && message !== ENGINE_RESET;
	const nodeDied = backend === "node" && NODE_DEAD_RE.test(message);
	if (!gpuFault && !nodeDied) return false;
	if (gpuFault) gpuFailed = true;
	logWarn(
		gpuFault
			? "Supertonic on the GPU failed; switching to the CPU until settings change."
			: "Native Supertonic stopped; restarting it.",
		{ source: "tts", detail: message },
	);
	if (active === backend) teardown(message);
	return true;
}

/** Attachment A of the model's OpenRAIL-M licence, condensed. */
const USE_RESTRICTIONS = [
	"Break any applicable law or regulation.",
	"Exploit or harm minors in any way.",
	"Generate or spread verifiably false information meant to harm others.",
	"Generate or spread personal information that can be used to harm someone.",
	"Publish generated content without clearly disclosing that it is machine-generated.",
	"Defame, disparage or harass others.",
	"Impersonate anyone without their consent (e.g. deepfakes).",
	"Make fully automated decisions that adversely affect someone's legal rights or create binding obligations.",
	"Discriminate against or harm people based on social behaviour or personal characteristics, or on legally protected characteristics.",
	"Exploit vulnerabilities of a group (age, social, physical or mental traits) to distort behaviour in a harmful way.",
	"Give medical advice or interpret medical results.",
	"Support justice, law-enforcement, immigration or asylum decisions (e.g. predicting crime or fraud).",
];

export const supertonicEngine: TtsEngine = {
	id: "supertonic",
	displayName: "Supertonic 3",
	licence: {
		name: "OpenRAIL-M",
		url: "https://huggingface.co/supertone-oss-archive/supertonic-3/blob/main/LICENSE",
		acknowledge: { summary: USE_RESTRICTIONS, text: licenceText },
	},
	languages: SUPERTONIC_LANGS,
	sampleRate: SUPERTONIC_SAMPLE_RATE,
	defaultVoice: SUPERTONIC_DEFAULT_VOICE,
	listVoices: supertonicVoiceOptions,
	ensureLoaded,
	activeBackend: () => active,
	synthesize,
	recover,
	cacheTag: () => String(useTtsStore.getState().supertonicSteps),
	dispose() {
		teardown();
		gpuFailed = false;
		useTtsStore.getState().setModelProgress(null);
	},
	onReset: null,
};
