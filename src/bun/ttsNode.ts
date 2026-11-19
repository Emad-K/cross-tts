import { join } from "node:path";
import {
	utilityProcess,
	type BrowserWindow,
	type UtilityProcess,
} from "electron";
import type {
	TtsNodeGenerateParams,
	TtsNodeGenerateResult,
	TtsNodeEngine,
	TtsNodeEp,
	TtsNodeInitResult,
} from "../shared/ttsNodeRpc";
import { hubCacheDirectory } from "./kokoroHubServer";
import { mainLog } from "./logBridge";

/**
 * Manages the native-CPU TTS utility process (see ttsNodeWorker.ts) and
 * bridges renderer RPC to it. The utility process crash-isolates
 * onnxruntime-node from the main process; if it dies mid-request every
 * pending generate resolves with an error and the renderer falls back to
 * its WASM path on the next init.
 */

let child: UtilityProcess | null = null;
/** Engine the running process serves (one native engine at a time). */
let childEngine: TtsNodeEngine | null = null;
/** Execution provider the running process was started for. */
let childEp: TtsNodeEp = "cpu";
/**
 * The process died while on a GPU provider (driver crash, out of memory).
 * Until the settings change, start it on the CPU instead of crashing again.
 */
let gpuCrashed = false;
let initPromise: Promise<TtsNodeInitResult> | null = null;
let seq = 0;
const pending = new Map<number, (result: TtsNodeGenerateResult) => void>();
let progressTarget: BrowserWindow | null = null;

export function setTtsNodeProgressTarget(win: BrowserWindow | null): void {
	progressTarget = win;
}

function failAllPending(message: string): void {
	for (const resolve of pending.values()) {
		resolve({ kind: "error", message });
	}
	pending.clear();
}

/** Stop the native process; with `engine`, only if it serves that engine. */
export function stopTtsNode(engine?: TtsNodeEngine): void {
	if (engine && childEngine && engine !== childEngine) return;
	failAllPending("TTS engine stopped");
	child?.kill();
	child = null;
	childEngine = null;
	initPromise = null;
}

/** The backend setting changed: give the GPU provider another chance. */
export function clearTtsNodeGpuCrash(): void {
	gpuCrashed = false;
}

/** Utility-process entry per engine (electron.vite.config.ts inputs). */
const WORKER_ENTRY: Record<TtsNodeEngine, string> = {
	kokoro: "ttsNodeWorker.js",
	supertonic: "supertonicNodeWorker.js",
};

export function ttsNodeInit(
	hubBaseUrl: string | null,
	numThreads: number,
	engine: TtsNodeEngine = "kokoro",
	requestedEp: TtsNodeEp = "cpu",
	/** Folder of the CUDA add-on (cudaAddon.ts); required for "cuda". */
	cudaDir?: string,
): Promise<TtsNodeInitResult> {
	const ep = gpuCrashed ? "cpu" : requestedEp;
	if (initPromise && childEngine === engine && childEp === ep) return initPromise;
	stopTtsNode();
	// onnxruntime-node >= 1.2x ships no darwin/x64 binding: Intel Macs use the
	// WASM engine. Say so instead of spawning a process that can't load it.
	if (process.platform === "darwin" && process.arch === "x64") {
		return Promise.resolve({
			ok: false,
			error: "Native engine isn't available on Intel Macs",
		});
	}
	// transformers.js 4 needs the hub's on-disk cache to hand ORT a model path,
	// and voices come from the hub; without it, native init can't work offline.
	if (!hubBaseUrl) {
		return Promise.resolve({
			ok: false,
			error: "Local model hub isn't running",
		});
	}
	initPromise = new Promise<TtsNodeInitResult>((resolve) => {
		const proc = utilityProcess.fork(join(__dirname, WORKER_ENTRY[engine]), [], {
			serviceName: "cross-tts-native-tts",
			// ORT loads its providers from the folder libonnxruntime came from,
			// and the installed app's folder is read-only: put the add-on's copy
			// first on the loader path. Ahead of any existing value (AppImage).
			...(ep === "cuda" && cudaDir
				? {
						env: {
							...process.env,
							LD_LIBRARY_PATH: [cudaDir, process.env.LD_LIBRARY_PATH]
								.filter(Boolean)
								.join(":"),
						},
					}
				: {}),
		});
		child = proc;
		childEngine = engine;
		childEp = ep;
		proc.on("message", (msg) => {
			switch (msg?.type) {
				case "progress": {
					const wc = progressTarget?.webContents;
					if (wc && !wc.isDestroyed()) {
						wc.send("app:tts-node-progress", msg.value);
					}
					break;
				}
				case "log":
					mainLog({ level: msg.level, source: "models", message: msg.message });
					break;
				case "ready":
					resolve({
						ok: true,
						voices: msg.voices,
						loadMs: msg.loadMs,
						device: msg.device ?? "cpu",
					});
					break;
				case "initError":
					stopTtsNode();
					resolve({ ok: false, error: msg.message });
					break;
				case "result": {
					const respond = pending.get(msg.id);
					if (!respond) break;
					pending.delete(msg.id);
					if (msg.error) respond({ kind: "error", message: msg.error });
					else if (msg.empty) respond({ kind: "empty" });
					else
						respond({
							kind: "audio",
							audio: msg.audio,
							samplingRate: msg.samplingRate,
							synthMs: msg.synthMs,
							device: msg.device ?? "cpu",
						});
					break;
				}
			}
		});
		proc.on("exit", (code) => {
			// A process swapped out for another engine was already cleaned up by
			// stopTtsNode; its late exit mustn't fail the new process's requests.
			if (child === proc) {
				if (code !== 0 && ep !== "cpu") gpuCrashed = true;
				child = null;
				childEngine = null;
				initPromise = null;
				failAllPending(`Native TTS process exited (code ${code})`);
			}
			if (code !== 0) {
				mainLog({
					level: "warn",
					source: "models",
					message: `Native TTS process exited unexpectedly (code ${code}).`,
				});
			}
			resolve({ ok: false, error: `Native TTS process exited (code ${code})` });
		});
		proc.postMessage({
			type: "init",
			hubBaseUrl,
			hubCacheDir: hubCacheDirectory(),
			numThreads,
			ep,
		});
	});
	return initPromise;
}

export function ttsNodeGenerate(
	params: TtsNodeGenerateParams,
): Promise<TtsNodeGenerateResult> {
	const proc = child;
	if (!proc) {
		return Promise.resolve({
			kind: "error",
			message: "Native TTS engine not running",
		});
	}
	const id = ++seq;
	return new Promise<TtsNodeGenerateResult>((resolve) => {
		pending.set(id, resolve);
		// `params` comes from the renderer: copy only the job fields, so it
		// can't turn this into an init (hub URL/cache dir) or reuse an id.
		proc.postMessage({
			text: params.text,
			voice: params.voice,
			speed: params.speed,
			pronunciationRules: params.pronunciationRules,
			steps: params.steps,
			epoch: params.epoch,
			type: "generate",
			id,
		});
	});
}
