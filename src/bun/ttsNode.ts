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

/** Utility-process entry per engine (electron.vite.config.ts inputs). */
const WORKER_ENTRY: Record<TtsNodeEngine, string> = {
	kokoro: "ttsNodeWorker.js",
	supertonic: "supertonicNodeWorker.js",
};

export function ttsNodeInit(
	hubBaseUrl: string | null,
	numThreads: number,
	cuda: boolean,
	engine: TtsNodeEngine = "kokoro",
): Promise<TtsNodeInitResult> {
	if (initPromise && childEngine === engine) return initPromise;
	if (childEngine !== engine) stopTtsNode();
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
		});
		child = proc;
		childEngine = engine;
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
					resolve({ ok: true, voices: msg.voices, loadMs: msg.loadMs });
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
						});
					break;
				}
			}
		});
		proc.on("exit", (code) => {
			if (child === proc) {
				child = null;
				childEngine = null;
				initPromise = null;
			}
			failAllPending(`Native TTS process exited (code ${code})`);
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
			cuda,
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
		proc.postMessage({ type: "generate", id, ...params });
	});
}
