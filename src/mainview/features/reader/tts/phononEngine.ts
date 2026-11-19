import { PhononTTS } from "phonon-tts";
import {
	PHONON_DEFAULT_VOICE,
	PHONON_REPO,
	PHONON_REVISION,
	PHONON_VOICES,
	PHONON_VOICES_REPO,
	PHONON_VOICES_REVISION,
	PHONON_WEIGHTS,
	phononVoicePath,
} from "@shared/phononAssets";
import { getKokoroHubBaseUrl } from "@/lib/desktopBridge";
import { logError, logInfo, logWarn } from "../logging";
import { isPlausibleAudio } from "./audioPlausibility";
import {
	durationDeltaForSpeed,
	RunawayWatch,
	splitForPhonon,
} from "./phononGuard";
import { CANCELLED, SynthJobQueue } from "./synthJobQueue";
import type {
	TtsBackendPrefs,
	TtsEngine,
	TtsSynthOptions,
	TtsVoice,
} from "./ttsEngineTypes";
import { useTtsStore } from "./ttsStore";

/**
 * Phonon 31M (Gradium; Pocket TTS + Mimi by Kyutai) on its official
 * WebAssembly runtime, phonon-tts, which runs the model in its own module
 * worker on the CPU. Model files come through the local hub (pinned,
 * sha256-checked); the runtime's own Cache API copy is off.
 *
 * There is no native backend: Phonon has no complete ONNX export for
 * onnxruntime-node, and the wasm build already runs ~6× faster than real time.
 */

const SAMPLE_RATE = 24_000;
const ENGINE_RESET = "TTS engine reset";
const ENGINE_TIMEOUT = "TTS engine timed out";
/** Jobs orphaned by recover()'s restart fail with this, and retry without another one. */
const ENGINE_RESTARTED = "Phonon restarted";
/** No audio piece (80 ms of speech) for this long means the worker hung. */
const STALL_MS = 30_000;
/** Measured on an 8-core desktop: 3 threads is fastest; more get slower. */
const MAX_THREADS = 3;

type Job = {
	text: string;
	voice: string;
	speed: number;
	epoch?: number;
	signal?: AbortSignal;
	/** loadGen when queued; a teardown since then fails the job. */
	gen: number;
	resolve: (pcm: Float32Array | null) => void;
	reject: (e: Error) => void;
};

let tts: PhononTTS | null = null;
/** duration_delta the loaded instance was started with. */
let loadedDelta = 0;
let loading: Promise<PhononTTS> | null = null;
/** Bumped by every teardown so a superseded load can't install itself. */
let loadGen = 0;
/** Why the last teardown happened; jobs it orphaned fail with it (and retry). */
let resetReason = ENGINE_RESET;
let lastPrefs: TtsBackendPrefs | null = null;
let hubBase: Promise<string> | null = null;

function hubBaseUrl(): Promise<string> {
	// Outside the desktop app (no hub) fall back to the Hub itself, unverified.
	hubBase ??= getKokoroHubBaseUrl().then(
		(b) => (b ? (b.endsWith("/") ? b : `${b}/`) : "https://huggingface.co/"),
	);
	return hubBase;
}

function teardown(reason = ENGINE_RESET): void {
	loadGen++;
	resetReason = reason;
	tts?.dispose();
	tts = null;
	loading = null;
	useTtsStore.getState().setModelPhase("idle");
	phononEngine.onReset?.();
}

/** The loaded runtime, started with `delta`; reloads when it differs. */
function instanceFor(delta: number, prefs: TtsBackendPrefs): Promise<PhononTTS> {
	if (tts && loadedDelta === delta) return Promise.resolve(tts);
	if (loading && loadedDelta === delta) return loading;
	if (loading) return loading.then(() => instanceFor(delta, prefs));
	if (tts) {
		// A speed change: the conditioner is fixed per load. Loading is
		// ~0.5 s with the files on disk.
		tts.dispose();
		tts = null;
	}
	const gen = loadGen;
	const { setModelPhase, setModelProgress } = useTtsStore.getState();
	setModelPhase("loading");
	setModelProgress(0);
	loadedDelta = delta;
	const started = performance.now();
	loading = (async () => {
		const base = await hubBaseUrl();
		const m = `${base}${PHONON_REPO}/resolve/${PHONON_REVISION}/`;
		const v = `${base}${PHONON_VOICES_REPO}/resolve/${PHONON_VOICES_REVISION}/`;
		const threads = Math.max(1, Math.min(prefs.cpuThreads, MAX_THREADS));
		const instance = await PhononTTS.load({
			lang: "en",
			cache: false,
			threads,
			device: "cpu",
			conditions: { duration_delta: delta },
			model: {
				weights: { q8: `${m}${PHONON_WEIGHTS}` },
				tokenizer: `${m}tokenizer.json`,
				config: `${m}config.json`,
				voices: Object.fromEntries(
					PHONON_VOICES.map(([id]) => [id, `${v}${phononVoicePath(id)}`]),
				),
				defaultVoice: PHONON_DEFAULT_VOICE,
			},
			onProgress: ({ file, loaded, total }) => {
				if (file.endsWith(PHONON_WEIGHTS) && total) {
					setModelProgress(loaded / total);
				}
			},
		});
		if (gen !== loadGen) {
			instance.dispose();
			throw new Error(ENGINE_RESET);
		}
		tts = instance;
		setModelPhase("ready");
		logInfo(
			`Phonon ready (CPU, ${instance.threads} thread(s)) — loaded in ` +
				`${((performance.now() - started) / 1000).toFixed(1)}s.`,
			{ source: "models" },
		);
		return instance;
	})();
	loading
		.catch((e: unknown) => {
			if (gen !== loadGen) return;
			const msg = e instanceof Error ? e.message : String(e);
			tts = null;
			setModelPhase("error", msg);
			logError("Couldn't load the Phonon voice model.", {
				source: "models",
				detail: msg,
			});
		})
		.finally(() => {
			if (gen === loadGen) loading = null;
		});
	return loading;
}

/**
 * Speak one piece, watching for a runaway generation (far too much audio, or
 * looping silence). A runaway piece is re-split once and its halves spoken
 * separately: the runtime is seeded, so the same text would run away again.
 */
async function speakPiece(
	inst: PhononTTS,
	job: Job,
	text: string,
	retry: boolean,
): Promise<Float32Array[]> {
	const watch = new RunawayWatch(text.length, SAMPLE_RATE);
	const chunks: Float32Array[] = [];
	const stream = inst.stream(text, { voice: job.voice });
	let runaway = false;
	let stall: ReturnType<typeof setTimeout> | undefined;
	let timedOut: (e: Error) => void = () => {};
	const stalled = new Promise<never>((_, reject) => (timedOut = reject));
	const armStall = () => {
		clearTimeout(stall);
		stall = setTimeout(() => timedOut(new Error(ENGINE_TIMEOUT)), STALL_MS);
	};
	armStall();
	try {
		const it = stream[Symbol.asyncIterator]();
		for (;;) {
			const next = await Promise.race([it.next(), stalled]);
			if (next.done) break;
			armStall();
			if (queue.isStale(job) || job.signal?.aborted) {
				stream.cancel();
				throw new Error(CANCELLED);
			}
			chunks.push(next.value);
			if (watch.push(next.value)) {
				runaway = true;
				stream.cancel();
				break;
			}
		}
	} finally {
		clearTimeout(stall);
	}
	if (!runaway) return chunks;
	const halves = splitForPhonon(text, Math.ceil(text.length / 2) + 1);
	logWarn("Phonon ran away on a sentence; speaking it in parts.", {
		source: "tts",
		detail: text.slice(0, 120),
	});
	if (retry && halves.length > 1) {
		const out: Float32Array[] = [];
		for (const half of halves) out.push(...(await speakPiece(inst, job, half, false)));
		return out;
	}
	// ponytail: keep the audio up to the budget rather than drop the sentence;
	// a smarter cut (last pause before the budget) if this is ever heard.
	let keep = watch.maxSamples;
	return chunks.map((c) => {
		const piece = c.subarray(0, Math.max(0, keep));
		keep -= c.length;
		return piece;
	});
}

const queue: SynthJobQueue<Job> = new SynthJobQueue<Job>(async (job): Promise<void> => {
	try {
		if (job.gen !== loadGen) throw new Error(resetReason);
		if (queue.isStale(job) || job.signal?.aborted) throw new Error(CANCELLED);
		const inst = await instanceFor(
			durationDeltaForSpeed(job.speed),
			lastPrefs ?? { gpu: false, gpuPower: "auto", cpuThreads: MAX_THREADS },
		);
		const chunks: Float32Array[] = [];
		for (const piece of splitForPhonon(job.text)) {
			chunks.push(...(await speakPiece(inst, job, piece, true)));
		}
		const length = chunks.reduce((n, c) => n + c.length, 0);
		if (length === 0) {
			job.resolve(null);
			return;
		}
		const audio = new Float32Array(length);
		let at = 0;
		for (const c of chunks) {
			audio.set(c, at);
			at += c.length;
		}
		if (!isPlausibleAudio(audio)) throw new Error("Phonon returned implausible audio");
		job.resolve(audio);
	} catch (e) {
		// Torn down mid-job (the runtime then says "disposed"): report why.
		const message =
			job.gen !== loadGen ? resetReason : e instanceof Error ? e.message : String(e);
		job.reject(new Error(message));
	}
});

const VOICES: TtsVoice[] = PHONON_VOICES.map(([id, label, language]) => ({
	id,
	label,
	language,
}));

export const phononEngine: TtsEngine = {
	id: "phonon",
	displayName: "Phonon 31M",
	licence: {
		name: "Apache-2.0",
		url: "https://huggingface.co/gradium/phonon-31m-en",
		notice:
			"Phonon 31M by Gradium, built on Kyutai's Pocket TTS and Mimi. Model " +
			"and voices (gradium/phonon-voices): Apache-2.0. Runtime: phonon-tts " +
			"(MIT or Apache-2.0).",
	},
	languages: ["en-us", "en-gb", "en"],
	sampleRate: SAMPLE_RATE,
	defaultVoice: PHONON_DEFAULT_VOICE,
	listVoices: () => VOICES,
	async ensureLoaded(prefs) {
		lastPrefs = prefs;
		// Any instance will do; the queue reloads for another speed when needed.
		if (tts) return;
		await (loading ??
			instanceFor(durationDeltaForSpeed(useTtsStore.getState().speed), prefs));
	},
	activeBackend: () => (tts ? "wasm" : null),
	synthesize(text, voice, speed, opts: TtsSynthOptions) {
		if (!text.trim()) return Promise.resolve(null);
		return new Promise((resolve, reject) => {
			queue.push({
				text,
				voice,
				speed,
				epoch: opts.epoch,
				signal: opts.signal,
				gen: loadGen,
				resolve,
				reject,
			});
		});
	},
	/** A hung or crashed worker: start a fresh one and retry. */
	recover(_backend, message) {
		// Queued jobs the restart below orphaned: just retry on the new instance.
		if (message === ENGINE_RESTARTED) return true;
		if (message !== ENGINE_TIMEOUT && !message.startsWith("phonon-tts worker failed")) {
			return false;
		}
		logWarn("Phonon stopped responding; restarting it.", {
			source: "tts",
			detail: message,
		});
		teardown(ENGINE_RESTARTED);
		return true;
	},
	dispose() {
		teardown();
		useTtsStore.getState().setModelProgress(null);
	},
	onReset: null,
};
