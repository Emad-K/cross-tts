import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { app } from "electron";
import {
	APP_CONFIG_VERSION,
	type AppConfigFileV1,
	type AppConfigInfo,
	defaultAppConfig,
} from "../shared/appConfig";
import {
	type ShortcutAction,
	coerceShortcutBindings,
} from "../shared/shortcuts";

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
			cached = fallback;
			return cached;
		}
		const o = parsed as Record<string, unknown>;
		const storedVersion = typeof o.version === "number" ? o.version : 1;
		const next = { ...fallback };
		if (isAbsoluteUsableDir(o.dataDir)) next.dataDir = o.dataDir;
		// Only honor a stored GPU choice from the current schema. Older configs
		// (v1, GPU-off default) are migrated to the new GPU-on default; the user's
		// choice sticks again once they toggle it (which persists v2).
		if (storedVersion >= APP_CONFIG_VERSION && typeof o.gpuEnabled === "boolean") {
			next.gpuEnabled = o.gpuEnabled;
		}
		if (typeof o.cpuThreads === "number" && Number.isFinite(o.cpuThreads)) {
			next.cpuThreads = Math.max(0, Math.floor(o.cpuThreads));
		}
		if (typeof o.shortcutsEnabled === "boolean") {
			next.shortcutsEnabled = o.shortcutsEnabled;
		}
		next.shortcuts = coerceShortcutBindings(o.shortcuts);
		cached = next;
		return cached;
	} catch {
		cached = fallback;
		return cached;
	}
}

function persist(config: AppConfigFileV1): void {
	cached = config;
	mkdirSync(defaultDataDir(), { recursive: true });
	writeFileSync(
		configPath(),
		JSON.stringify({ ...config, version: APP_CONFIG_VERSION }, null, "\t"),
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

export function gpuEnabled(): boolean {
	return loadAppConfig().gpuEnabled;
}

export function setGpuEnabled(value: boolean): void {
	persist({ ...loadAppConfig(), gpuEnabled: value });
}

export function setCpuThreads(value: number): void {
	const clean = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
	persist({ ...loadAppConfig(), cpuThreads: clean });
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

export function setShortcutBinding(action: ShortcutAction, accel: string): void {
	const config = loadAppConfig();
	persist({
		...config,
		shortcuts: { ...config.shortcuts, [action]: accel },
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
	return {
		appVersion: app.getVersion(),
		dataDir: resolved,
		defaultDataDir: def,
		isDefaultDataDir: resolved === def,
		gpuEnabled: config.gpuEnabled,
		cpuThreads: config.cpuThreads,
		shortcutsEnabled: config.shortcutsEnabled,
		shortcuts: config.shortcuts,
		modelsDownloaded: modelBytes > 0,
		modelBytes,
	};
}
