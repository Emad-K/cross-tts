import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { app } from "electron";
import { CUDA_ADDON, cudaAddonInstalled } from "./cudaAddon";
import { cudaSystemReady, ortBindingDir } from "./cudaSupport";
import {
	APP_CONFIG_VERSION,
	type AppConfigFileV1,
	type AppConfigInfo,
	type BackendAvailability,
	type GpuPowerPreference,
	coerceTtsBackend,
	defaultAppConfig,
	effectiveTtsBackend,
} from "../shared/appConfig";
import { type Appearance, coerceAppearance } from "../shared/appearance";
import {
	type ShortcutAction,
	coerceShortcutBindings,
} from "../shared/shortcuts";
import { coerceWatchedFolders } from "../shared/watchedFolders";
import { backupUnreadableFile, writeFileAtomic } from "./atomicFile";

const CONFIG_NAME = "app-config.json";
const MODEL_SUBDIR = "kokoro-hf-hub";

/** The OS default data directory (Electron userData). Always available pre-boot. */
export function defaultDataDir(): string {
	return app.getPath("userData");
}

/** The bootstrap config always lives at the OS default location, never the custom one. */
function configPath(): string {
	return join(defaultDataDir(), CONFIG_NAME);
}

let cached: AppConfigFileV1 | null = null;

function isAbsoluteUsableDir(dir: unknown): dir is string {
	return typeof dir === "string" && dir.trim().length > 0 && isAbsolute(dir);
}

export function loadAppConfig(): AppConfigFileV1 {
	if (cached) return cached;
	const fallback = defaultAppConfig(defaultDataDir());
	const p = configPath();
	if (!existsSync(p)) {
		cached = fallback;
		return cached;
	}
	try {
		const parsed = JSON.parse(readFileSync(p, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object") {
			backupUnreadableFile(p);
			cached = fallback;
			return cached;
		}
		const o = parsed as Record<string, unknown>;
		const next = { ...fallback };
		if (isAbsoluteUsableDir(o.dataDir)) next.dataDir = o.dataDir;
		// Also maps the 1.14 settings (GPU switch, CUDA opt-in) to a backend.
		next.ttsBackend = coerceTtsBackend(o);
		if (
			o.gpuPower === "auto" ||
			o.gpuPower === "high-performance" ||
			o.gpuPower === "low-power"
		) {
			next.gpuPower = o.gpuPower;
		}
		if (typeof o.cpuThreads === "number" && Number.isFinite(o.cpuThreads)) {
			next.cpuThreads = Math.max(0, Math.floor(o.cpuThreads));
		}
		if (typeof o.gpuFp16 === "boolean") next.gpuFp16 = o.gpuFp16;
		if (typeof o.shortcutsEnabled === "boolean") {
			next.shortcutsEnabled = o.shortcutsEnabled;
		}
		// Absent (older configs) stays null → the user is prompted once.
		if (typeof o.autoUpdate === "boolean") {
			next.autoUpdate = o.autoUpdate;
		}
		if (typeof o.crashPromptDisabled === "boolean") {
			next.crashPromptDisabled = o.crashPromptDisabled;
		}
		next.shortcuts = coerceShortcutBindings(o.shortcuts);
		next.appearance = coerceAppearance(o.appearance);
		next.watchedFolders =
			coerceWatchedFolders(o.watchedFolders).filter(isAbsoluteUsableDir);
		cached = next;
		return cached;
	} catch (err) {
		// Keep the broken file around: the next persist() rewrites it from defaults.
		const bak = backupUnreadableFile(p);
		console.error(`[config] unreadable ${p}, backed up to ${bak}:`, err);
		cached = fallback;
		return cached;
	}
}

function persist(config: AppConfigFileV1): void {
	cached = config;
	mkdirSync(defaultDataDir(), { recursive: true });
	writeFileAtomic(
		configPath(),
		JSON.stringify(
			{
				...config,
				// For a downgrade to 1.14, which only knows this switch.
				gpuEnabled: config.ttsBackend === "auto" || config.ttsBackend === "webgpu",
				version: APP_CONFIG_VERSION,
			},
			null,
			"\t",
		),
	);
}

/** Resolved directory where models + session are stored (custom or OS default). */
export function dataDir(): string {
	const dir = loadAppConfig().dataDir;
	return isAbsoluteUsableDir(dir) ? dir : defaultDataDir();
}

export function modelCacheDir(): string {
	return join(dataDir(), MODEL_SUBDIR);
}

let nativeEngine: boolean | null = null;

/** Which speech backends this machine can offer (see BackendAvailability). */
export function backendAvailability(): BackendAvailability {
	if (nativeEngine === null) {
		try {
			nativeEngine = existsSync(ortBindingDir());
		} catch {
			nativeEngine = false;
		}
	}
	return {
		native: nativeEngine,
		dml: nativeEngine && process.platform === "win32",
		cuda: !nativeEngine || !cudaSystemReady()
			? "unavailable"
			: cudaAddonInstalled(defaultDataDir())
				? "ready"
				: "needs-addon",
	};
}

/** Store a backend choice; one this machine can't run is ignored. */
export function setTtsBackend(value: unknown): void {
	const choice = coerceTtsBackend({ ttsBackend: value });
	if (choice !== value) return;
	if (effectiveTtsBackend(choice, backendAvailability()) !== choice) return;
	persist({ ...loadAppConfig(), ttsBackend: choice });
}

export function setGpuPower(value: GpuPowerPreference): void {
	persist({ ...loadAppConfig(), gpuPower: value });
}

export function setCpuThreads(value: number): void {
	const clean = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
	persist({ ...loadAppConfig(), cpuThreads: clean });
}

export function setGpuFp16(value: boolean): void {
	persist({ ...loadAppConfig(), gpuFp16: value });
}

export function shortcutsEnabled(): boolean {
	return loadAppConfig().shortcutsEnabled;
}

export function shortcutBindings() {
	return loadAppConfig().shortcuts;
}

export function setShortcutsEnabled(value: boolean): void {
	persist({ ...loadAppConfig(), shortcutsEnabled: value });
}

/** Auto-update preference: true/false chosen, null = not asked yet. */
export function autoUpdatePref(): boolean | null {
	return loadAppConfig().autoUpdate;
}

export function setAutoUpdate(value: boolean): void {
	persist({ ...loadAppConfig(), autoUpdate: value });
}

/** Folders scanned for new documents to auto-add to the library. */
export function watchedFolders(): string[] {
	return loadAppConfig().watchedFolders;
}

/** Add one absolute folder to the watched list (no-op if already present). */
export function addWatchedFolder(dir: string): void {
	if (!isAbsoluteUsableDir(dir)) return;
	const config = loadAppConfig();
	if (config.watchedFolders.includes(dir)) return;
	persist({ ...config, watchedFolders: [...config.watchedFolders, dir] });
}

/** Remove one folder from the watched list. */
export function removeWatchedFolder(dir: string): void {
	const config = loadAppConfig();
	if (!config.watchedFolders.includes(dir)) return;
	persist({
		...config,
		watchedFolders: config.watchedFolders.filter((d) => d !== dir),
	});
}

/** "Don't ask again" for the post-crash report dialog. */
export function crashPromptDisabled(): boolean {
	return loadAppConfig().crashPromptDisabled;
}

export function setCrashPromptDisabled(value: boolean): void {
	persist({ ...loadAppConfig(), crashPromptDisabled: value });
}

export function setShortcutBinding(action: ShortcutAction, accel: string): void {
	const config = loadAppConfig();
	persist({
		...config,
		shortcuts: { ...config.shortcuts, [action]: accel },
	});
}

export function setAppearance(patch: Partial<Appearance>): void {
	const config = loadAppConfig();
	persist({
		...config,
		appearance: coerceAppearance({ ...config.appearance, ...patch }),
	});
}

/** Persist a new data directory. Caller is responsible for relaunching to apply. */
export function setDataDir(dir: string): void {
	const next = isAbsoluteUsableDir(dir) ? dir : defaultDataDir();
	mkdirSync(next, { recursive: true });
	persist({ ...loadAppConfig(), dataDir: next });
}

/** Reset the data directory back to the OS default. */
export function resetDataDir(): void {
	persist({ ...loadAppConfig(), dataDir: defaultDataDir() });
}

function dirSizeBytes(dir: string): number {
	let total = 0;
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return 0;
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		try {
			const st = statSync(full);
			if (st.isDirectory()) total += dirSizeBytes(full);
			else total += st.size;
		} catch {
			// Skip unreadable entries.
		}
	}
	return total;
}

export function appConfigInfo(): AppConfigInfo {
	const config = loadAppConfig();
	const resolved = dataDir();
	const def = defaultDataDir();
	const modelBytes = dirSizeBytes(modelCacheDir());
	const backends = backendAvailability();
	return {
		appVersion: app.getVersion(),
		dataDir: resolved,
		defaultDataDir: def,
		isDefaultDataDir: resolved === def,
		ttsBackend: effectiveTtsBackend(config.ttsBackend, backends),
		ttsBackendChosen: config.ttsBackend,
		backends,
		cudaAddonBytes: CUDA_ADDON.bytes,
		gpuPower: config.gpuPower,
		cpuThreads: config.cpuThreads,
		gpuFp16: config.gpuFp16,
		shortcutsEnabled: config.shortcutsEnabled,
		shortcuts: config.shortcuts,
		autoUpdate: config.autoUpdate,
		appearance: config.appearance,
		watchedFolders: config.watchedFolders,
		modelsDownloaded: modelBytes > 0,
		modelBytes,
	};
}
