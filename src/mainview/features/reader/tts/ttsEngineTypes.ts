import type { GpuPowerPreference } from "@shared/appConfig";

/**
 * A text-to-speech model the reader can play and export with. The
 * orchestrator (ttsEngine.ts) owns playback, prefetch, the audio cache,
 * cancellation epochs and the retry after a backend failure; an engine owns
 * its model, backends and model-specific limits (e.g. Kokoro's 500-token
 * phoneme split).
 *
 * Shaped for Kokoro now, and for engines that need a per-call language
 * (multilingual models whose voices aren't tied to one) or stream audio.
 */

export type TtsVoice = {
	id: string;
	label: string;
	/** BCP 47-ish code, e.g. "en-us", "pt-br". */
	language: string;
};

/** Hardware preferences from Settings → Performance. */
export type TtsBackendPrefs = {
	/** Use the GPU when one is usable. */
	gpu: boolean;
	gpuPower: GpuPowerPreference;
	/** CPU inference threads (already resolved from "auto"). */
	cpuThreads: number;
	/** Prefer half-precision weights on the GPU where supported (opt-in). */
	gpuFp16: boolean;
};

export type TtsSynthOptions = {
	/**
	 * Playback epoch. Engines drop queued requests from older epochs and fail
	 * them with CANCELLED (synthJobQueue.ts). Omitted for export.
	 */
	epoch?: number;
	signal?: AbortSignal;
	/** Language for engines whose voices aren't tied to one. */
	lang?: string;
};

export interface TtsEngine {
	readonly id: string;
	readonly displayName: string;
	readonly licence: { name: string; url: string };
	readonly languages: readonly string[];
	/** Rate of the PCM `synthesize` returns. */
	readonly sampleRate: number;
	readonly defaultVoice: string;
	listVoices(): TtsVoice[];
	/** Load the model on the best backend the prefs allow; shared while in flight. */
	ensureLoaded(prefs: TtsBackendPrefs): Promise<void>;
	/** Backend running requests now (e.g. "webgpu", "node"); null when not loaded. */
	activeBackend(): string | null;
	/**
	 * Anything else about the loaded model that changes its audio (e.g. the
	 * weights' precision); part of the audio cache key.
	 */
	audioVariant?(): string;
	/**
	 * Mono PCM at `sampleRate` for already rule-processed text; null when there
	 * is nothing to speak. Throws Error(message) on failure, Error(CANCELLED)
	 * when the request went stale.
	 */
	synthesize(
		text: string,
		voice: string,
		speed: number,
		opts: TtsSynthOptions,
	): Promise<Float32Array | null>;
	/**
	 * A request on `backend` failed with `message`. Return true when the engine
	 * dropped that backend (e.g. GPU → CPU) and a retry after ensureLoaded may
	 * succeed.
	 */
	recover?(backend: string, message: string): boolean;
	/** Audio as it is generated, for engines that stream. */
	synthesizeStream?(
		text: string,
		voice: string,
		speed: number,
		opts: TtsSynthOptions,
	): AsyncIterable<Float32Array>;
	/** Unload the model and forget backend failures (settings changed). */
	dispose(): void;
	/** Called whenever the engine tears its backend down; audio made before may differ. */
	onReset: (() => void) | null;
}
