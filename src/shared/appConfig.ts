/**
 * Bootstrap app config (v1). Stored at the OS default app-data directory so it
 * can be read *before* anything else — it tells the app where the relocatable
 * data directory (models + session) actually lives. Keep in shared so Bun (main)
 * and the webview agree on the shape.
 */
export const APP_CONFIG_VERSION = 1;

export type AppConfigFileV1 = {
	version: typeof APP_CONFIG_VERSION;
	/** Absolute directory holding TTS models and the session file. Empty = OS default. */
	dataDir: string;
	/** Use the GPU (WebGPU) for TTS when available; false forces CPU (wasm). */
	gpuEnabled: boolean;
};

/**
 * What the renderer needs to render the Settings UI. `defaultDataDir` is the
 * OS-appropriate location used when the user hasn't chosen a custom one.
 */
export type AppConfigInfo = {
	dataDir: string;
	defaultDataDir: string;
	/** True when `dataDir` is the OS default (user hasn't picked a custom folder). */
	isDefaultDataDir: boolean;
	gpuEnabled: boolean;
	/** Whether model files already exist on disk at `dataDir`. */
	modelsDownloaded: boolean;
	/** Approximate size of downloaded model files, in bytes. */
	modelBytes: number;
};

export const defaultAppConfig = (defaultDataDir: string): AppConfigFileV1 => ({
	version: APP_CONFIG_VERSION,
	dataDir: defaultDataDir,
	gpuEnabled: false,
});
