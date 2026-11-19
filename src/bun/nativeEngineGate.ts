/**
 * Pure decisions about the native (onnxruntime-node) speech engine, kept out
 * of ttsNode.ts / crashReports.ts so they can be unit tested without Electron.
 */

/** `serviceName` of the native TTS utility process (ttsNode.ts). */
export const NATIVE_TTS_SERVICE_NAME = "cross-tts-native-tts";

/** File onnxruntime-node loads; absent where it ships no build (Intel Macs). */
export const ORT_BINDING_FILE = "onnxruntime_binding.node";

export type NativeSpawnDecision = { ok: true } | { ok: false; error: string };

/** Whether to start the native TTS process at all. */
export function nativeSpawnDecision(input: {
	/** onnxruntime-node's binding file exists for this platform and arch. */
	bindingPresent: boolean;
	hubBaseUrl: string | null;
}): NativeSpawnDecision {
	// A process that can't load the binding only dies during init, which the
	// OS and the crash prompt would report as a crash. Don't start it.
	if (!input.bindingPresent) {
		return { ok: false, error: "Native engine isn't available on this computer" };
	}
	// transformers.js 4 needs the hub's on-disk cache to hand ORT a model path,
	// and voices come from the hub; without it, native init can't work offline.
	if (!input.hubBaseUrl) {
		return { ok: false, error: "Local model hub isn't running" };
	}
	return { ok: true };
}

/**
 * Whether a `child-process-gone` event is a crash worth asking the user to
 * report. A native TTS process that dies before it was ever ready is an
 * expected failure (unsupported CPU or GPU driver, missing system library):
 * the renderer falls back to the WASM engine and the log already says why.
 */
export function shouldRecordChildGone(
	details: { type: string; reason: string; serviceName?: string },
	state: { nativeReady: boolean },
): boolean {
	if (details.reason === "clean-exit" || details.reason === "killed") return false;
	if (details.serviceName === NATIVE_TTS_SERVICE_NAME && !state.nativeReady) {
		return false;
	}
	return true;
}
