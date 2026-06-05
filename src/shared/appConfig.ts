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

export type AppConfigFileV1 = {
	version: number;
	/** Absolute directory holding TTS models and the session file. Empty = OS default. */
	dataDir: string;
	/** Use the GPU (WebGPU) for TTS when available; false forces CPU (wasm). */
	gpuEnabled: boolean;
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
	/** CPU inference threads; 0 = auto. */
	cpuThreads: number;
	shortcutsEnabled: boolean;
	shortcuts: ShortcutBindings;
	/** Whether model files already exist on disk at `dataDir`. */
	modelsDownloaded: boolean;
	/** Approximate size of downloaded model files, in bytes. */
	modelBytes: number;
};

export const defaultAppConfig = (defaultDataDir: string): AppConfigFileV1 => ({
	version: APP_CONFIG_VERSION,
	dataDir: defaultDataDir,
	gpuEnabled: true,
	cpuThreads: 0,
	shortcutsEnabled: false,
	shortcuts: defaultShortcutBindings(),
});
