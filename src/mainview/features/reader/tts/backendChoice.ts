import type { TtsBackend } from "@shared/appConfig";
import { showToast } from "@/components/toast/toastStore";
import { logWarn } from "../logging";

/** A backend a model can actually be running on (every choice but "auto"). */
export type RunningBackend = Exclude<TtsBackend, "auto">;

/**
 * Backends to try, in order, for a backend choice (Settings → Voice →
 * Advanced, "Run speech on").
 * "cuda"/"dml" are the native engine on that GPU provider, "cpu" is the
 * native engine on the CPU, "webgpu"/"wasm" run in the renderer. A step that
 * can't start (no adapter, no native binding, a failed load) is skipped;
 * with `prefs.noFallback` only the first is tried.
 *
 * Supertonic keeps native CPU first unless WebGPU is picked: it is fast and
 * verified there, and CUDA/DirectML are wired up for Kokoro only.
 */
export function loadPlan(engineId: string, backend: TtsBackend): RunningBackend[] {
	if (backend === "wasm") return ["wasm"];
	if (backend === "cpu") return ["cpu", "wasm"];
	if (engineId === "supertonic") {
		if (backend === "webgpu") return ["webgpu", "cpu", "wasm"];
		return backend === "auto" ? ["cpu", "webgpu", "wasm"] : ["cpu", "wasm"];
	}
	if (backend === "cuda" || backend === "dml") return [backend, "cpu", "wasm"];
	return ["webgpu", "cpu", "wasm"];
}

/** What each "Run speech on" choice is called, everywhere it is named. */
export const BACKEND_LABEL: Record<TtsBackend, string> = {
	auto: "Automatic (recommended)",
	webgpu: "Graphics card",
	cuda: "NVIDIA graphics card",
	dml: "Graphics card (DirectML, experimental)",
	cpu: "Processor",
	wasm: "Processor (compatibility mode)",
};

/**
 * A backend a model is running on, with its technical name: the status line
 * in Settings, the fallback toast and the log.
 */
export const RUNNING_LABEL: Record<RunningBackend, string> = {
	webgpu: "Graphics card (WebGPU)",
	cuda: "NVIDIA graphics card (CUDA)",
	dml: "Graphics card (DirectML)",
	cpu: "Processor (native)",
	wasm: "Processor (compatibility mode, WASM)",
};

/**
 * What to tell the user when the GPU backend they picked isn't the one that
 * ended up running; null when there is nothing to say ("auto" and the CPU
 * choices fall back silently, as they always have).
 */
export function fallbackNotice(
	engineId: string,
	chosen: TtsBackend,
	running: RunningBackend,
): string | null {
	const wanted = loadPlan(engineId, chosen)[0];
	if (chosen === "auto" || wanted === running) return null;
	if (wanted !== "webgpu" && wanted !== "cuda" && wanted !== "dml") return null;
	return `Now running on: ${RUNNING_LABEL[running]}. ${RUNNING_LABEL[wanted]} couldn't start; details are in the log.`;
}

/** Log and show {@link fallbackNotice}, if any. */
export function announceFallback(
	engineId: string,
	chosen: TtsBackend,
	running: RunningBackend,
): void {
	const notice = fallbackNotice(engineId, chosen, running);
	if (!notice) return;
	logWarn(notice, { source: "models" });
	showToast({ title: notice });
}
