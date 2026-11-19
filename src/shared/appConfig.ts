import { type Appearance, defaultAppearance } from "./appearance";
import {
	type ShortcutBindings,
	defaultShortcutBindings,
} from "./shortcuts";

/**
 * Bootstrap app config (v1). Stored at the OS default app-data directory so it
 * can be read *before* anything else — it tells the app where the relocatable
 * data directory (models + session) actually lives. Keep in shared so Bun (main)
 * and the webview agree on the shape.
 */
// v2: GPU is enabled by default (used when a WebGPU adapter is present, CPU
// otherwise). Configs written by v1 are migrated to adopt this new default.
export const APP_CONFIG_VERSION = 2;

/**
 * Which GPU WebGPU should prefer. WebGPU can't pick a specific adapter by name;
 * it only exposes a power hint, which on multi-GPU machines selects the
 * dedicated ("high-performance") vs integrated ("low-power") GPU.
 */
export type GpuPowerPreference = "auto" | "high-performance" | "low-power";

/**
 * Where speech synthesis runs (Settings → Performance). "auto" picks the best
 * backend that works; the others are explicit choices that still fall back to
 * the CPU when they can't start.
 */
export const TTS_BACKENDS = ["auto", "webgpu", "cuda", "dml", "cpu", "wasm"] as const;
export type TtsBackend = (typeof TTS_BACKENDS)[number];

/** Which backends this machine can offer, as far as the main process can tell. */
export type BackendAvailability = {
	/** The native onnxruntime-node engine exists for this platform. */
	native: boolean;
	/** DirectML (Windows only). */
	dml: boolean;
	/**
	 * NVIDIA CUDA (Linux x64 only). "needs-addon": the CUDA 13 and cuDNN 9
	 * libraries are installed but the app's CUDA add-on isn't downloaded yet.
	 */
	cuda: "unavailable" | "needs-addon" | "ready";
};

/**
 * The stored backend choice, or the one older settings map to: GPU switched
 * off (schema v2) becomes "cpu", which loads in the same order GPU-off did;
 * otherwise the CUDA opt-in becomes "cuda".
 */
export function coerceTtsBackend(o: Record<string, unknown>): TtsBackend {
	if (TTS_BACKENDS.includes(o.ttsBackend as TtsBackend)) {
		return o.ttsBackend as TtsBackend;
	}
	// GPU switched off wins over the CUDA opt-in: "cuda" without its add-on
	// acts as "auto", which would turn WebGPU back on.
	const version = typeof o.version === "number" ? o.version : 1;
	if (version >= APP_CONFIG_VERSION && o.gpuEnabled === false) return "cpu";
	if (o.cudaEnabled === true) return "cuda";
	return "auto";
}

/**
 * The choice the app acts on: a GPU provider this machine can't run right now
 * (CUDA without its add-on, DirectML off Windows) counts as "auto", and the
 * native CPU where there is no native engine (Intel Macs) counts as "wasm".
 */
export function effectiveTtsBackend(
	chosen: TtsBackend,
	backends: BackendAvailability,
): TtsBackend {
	if (chosen === "cuda" && backends.cuda !== "ready") return "auto";
	if (chosen === "dml" && !backends.dml) return "auto";
	// Same thing runs either way (native CPU falls back to WASM); this only
	// keeps Settings from showing a native engine that doesn't exist here.
	if (chosen === "cpu" && !backends.native) return "wasm";
	return chosen;
}

export type AppConfigFileV1 = {
	version: number;
	/** Absolute directory holding TTS models and the session file. Empty = OS default. */
	dataDir: string;
	/** Where speech synthesis runs. */
	ttsBackend: TtsBackend;
	/**
	 * Read by version 1.14 and older only: always written as "ttsBackend is
	 * auto or webgpu", so a downgrade keeps roughly the same behaviour.
	 */
	gpuEnabled: boolean;
	/** Which GPU to prefer when more than one is present. */
	gpuPower: GpuPowerPreference;
	/**
	 * Number of CPU (wasm) inference threads. 0 = auto (the renderer picks a
	 * value based on the machine). The renderer clamps any value to
	 * `logicalCores - 1`.
	 */
	cpuThreads: number;
	/**
	 * Load Kokoro's half-precision (fp16) weights on WebGPU when the GPU has
	 * the shader-f16 feature. Opt-in: smaller and maybe faster, but quality
	 * hasn't been checked on every GPU. fp32 otherwise.
	 */
	gpuFp16: boolean;
	/** Global media shortcuts enabled (work when the app isn't focused). */
	shortcutsEnabled: boolean;
	/** Accelerator per action (Electron syntax). */
	shortcuts: ShortcutBindings;
	/**
	 * Automatic updates. `true`/`false` is the user's choice; `null` means they
	 * haven't been asked yet (prompt once on the next packaged launch).
	 */
	autoUpdate: boolean | null;
	/** Theme, color mode, and reading font. */
	appearance: Appearance;
	/** Folders scanned for new .epub/.txt files to auto-add to the library. */
	watchedFolders: string[];
	/** "Don't ask again" for the crash-report dialog shown after a crash. */
	crashPromptDisabled: boolean;
};

/**
 * What the renderer needs to render the Settings UI. `defaultDataDir` is the
 * OS-appropriate location used when the user hasn't chosen a custom one.
 */
export type AppConfigInfo = {
	/** App version (from package.json), e.g. "1.6.9". */
	appVersion: string;
	dataDir: string;
	defaultDataDir: string;
	/** True when `dataDir` is the OS default (user hasn't picked a custom folder). */
	isDefaultDataDir: boolean;
	/** The backend choice in effect (see effectiveTtsBackend). */
	ttsBackend: TtsBackend;
	/** What the user picked; differs from `ttsBackend` when it can't run here. */
	ttsBackendChosen: TtsBackend;
	backends: BackendAvailability;
	/** Download size of the CUDA add-on, in bytes. */
	cudaAddonBytes: number;
	gpuPower: GpuPowerPreference;
	/** CPU inference threads; 0 = auto. */
	cpuThreads: number;
	gpuFp16: boolean;
	shortcutsEnabled: boolean;
	shortcuts: ShortcutBindings;
	/** Automatic updates: true/false chosen, null = not asked yet. */
	autoUpdate: boolean | null;
	appearance: Appearance;
	/** Folders scanned for new .epub/.txt files to auto-add to the library. */
	watchedFolders: string[];
	/** Whether model files already exist on disk at `dataDir`. */
	modelsDownloaded: boolean;
	/** Approximate size of downloaded model files, in bytes. */
	modelBytes: number;
};

export const defaultAppConfig = (defaultDataDir: string): AppConfigFileV1 => ({
	version: APP_CONFIG_VERSION,
	dataDir: defaultDataDir,
	ttsBackend: "auto",
	gpuEnabled: true,
	gpuPower: "auto",
	cpuThreads: 0,
	gpuFp16: false,
	shortcutsEnabled: false,
	shortcuts: defaultShortcutBindings(),
	autoUpdate: null,
	appearance: defaultAppearance(),
	watchedFolders: [],
	crashPromptDisabled: false,
});
