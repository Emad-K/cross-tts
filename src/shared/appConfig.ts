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

export type AppConfigFileV1 = {
	version: number;
	/** Absolute directory holding TTS models and the session file. Empty = OS default. */
	dataDir: string;
	/** Use the GPU (WebGPU) for TTS when available; false forces CPU (wasm). */
	gpuEnabled: boolean;
	/** Which GPU to prefer when more than one is present. */
	gpuPower: GpuPowerPreference;
	/**
	 * Number of CPU (wasm) inference threads. 0 = auto (the renderer picks a
	 * value based on the machine). The renderer clamps any value to
	 * `logicalCores - 1`.
	 */
	cpuThreads: number;
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
	gpuEnabled: boolean;
	gpuPower: GpuPowerPreference;
	/** CPU inference threads; 0 = auto. */
	cpuThreads: number;
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
	gpuEnabled: true,
	gpuPower: "auto",
	cpuThreads: 0,
	shortcutsEnabled: false,
	shortcuts: defaultShortcutBindings(),
	autoUpdate: null,
	appearance: defaultAppearance(),
	watchedFolders: [],
	crashPromptDisabled: false,
});
