import { create } from "zustand";
import type {
	AppConfigInfo,
	GpuPowerPreference,
	TtsBackend,
} from "@shared/appConfig";
import type { Appearance } from "@shared/appearance";
import { MAX_CHUNK_CHARS_DEFAULT } from "@shared/appearance";
import { autoCpuThreads, maxSelectableCpuThreads } from "./cpuThreads";
import type { ShortcutAction } from "@shared/shortcuts";
import {
	getAppConfig,
	setAppearance as setAppearanceRpc,
	setAutoUpdate as setAutoUpdateRpc,
	setCpuThreads as setCpuThreadsRpc,
	setGpuFp16 as setGpuFp16Rpc,
	setGpuPower as setGpuPowerRpc,
	setShortcutBinding as setShortcutBindingRpc,
	setShortcutsEnabled as setShortcutsEnabledRpc,
	setTtsBackend as setTtsBackendRpc,
} from "@/lib/desktopBridge";
import { logError } from "../logging";

type AppSettingsState = {
	/** Null until hydrated from the main process (or when running outside Electron). */
	config: AppConfigInfo | null;
	loaded: boolean;
	/** Whether the renderer detected a usable WebGPU adapter. */
	webgpuAvailable: boolean | null;
	hydrate: () => Promise<void>;
	refresh: () => Promise<void>;
	setTtsBackend: (backend: TtsBackend) => Promise<void>;
	setGpuPower: (power: GpuPowerPreference) => Promise<void>;
	setCpuThreads: (threads: number) => Promise<void>;
	setGpuFp16: (enabled: boolean) => Promise<void>;
	setShortcutsEnabled: (enabled: boolean) => Promise<void>;
	setAutoUpdate: (enabled: boolean) => Promise<void>;
	setShortcutBinding: (
		action: ShortcutAction,
		accelerator: string,
	) => Promise<void>;
	setAppearance: (patch: Partial<Appearance>) => Promise<void>;
	setConfig: (config: AppConfigInfo) => void;
	setWebgpuAvailable: (available: boolean) => void;
};

export const useAppSettingsStore = create<AppSettingsState>((set, get) => ({
	config: null,
	loaded: false,
	webgpuAvailable: null,

	hydrate: async () => {
		if (get().loaded) return;
		const config = await getAppConfig();
		set({ config, loaded: true });
	},

	refresh: async () => {
		const config = await getAppConfig();
		if (config) set({ config });
	},

	setTtsBackend: async (backend) => {
		// Optimistic update so the picker feels instant; revert if the RPC fails.
		const prev = get().config;
		if (prev) {
			set({ config: { ...prev, ttsBackend: backend, ttsBackendChosen: backend } });
		}
		try {
			const config = await setTtsBackendRpc(backend);
			if (config) set({ config });
		} catch (e) {
			if (prev) set({ config: prev });
			logError("Couldn't change the speech backend.", {
				source: "settings",
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	},

	setGpuPower: async (power) => {
		const prev = get().config;
		if (prev) set({ config: { ...prev, gpuPower: power } });
		try {
			const config = await setGpuPowerRpc(power);
			if (config) set({ config });
		} catch (e) {
			if (prev) set({ config: prev });
			logError("Couldn't change the GPU preference.", {
				source: "settings",
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	},

	setGpuFp16: async (enabled) => {
		const prev = get().config;
		if (prev) set({ config: { ...prev, gpuFp16: enabled } });
		try {
			const config = await setGpuFp16Rpc(enabled);
			if (config) set({ config });
		} catch (e) {
			if (prev) set({ config: prev });
			logError("Couldn't change the half-precision setting.", {
				source: "settings",
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	},

	setCpuThreads: async (threads) => {
		const prev = get().config;
		if (prev) set({ config: { ...prev, cpuThreads: threads } });
		try {
			const config = await setCpuThreadsRpc(threads);
			if (config) set({ config });
		} catch (e) {
			if (prev) set({ config: prev });
			logError("Couldn't change the CPU threads setting.", {
				source: "settings",
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	},

	setShortcutsEnabled: async (enabled) => {
		const prev = get().config;
		if (prev) set({ config: { ...prev, shortcutsEnabled: enabled } });
		try {
			const config = await setShortcutsEnabledRpc(enabled);
			if (config) set({ config });
		} catch (e) {
			if (prev) set({ config: prev });
			logError("Couldn't change the shortcuts setting.", {
				source: "settings",
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	},

	setAutoUpdate: async (enabled) => {
		const prev = get().config;
		if (prev) set({ config: { ...prev, autoUpdate: enabled } });
		try {
			const config = await setAutoUpdateRpc(enabled);
			if (config) set({ config });
		} catch (e) {
			if (prev) set({ config: prev });
			logError("Couldn't change the auto-update setting.", {
				source: "settings",
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	},

	setShortcutBinding: async (action, accelerator) => {
		const prev = get().config;
		if (prev) {
			set({
				config: {
					...prev,
					shortcuts: { ...prev.shortcuts, [action]: accelerator },
				},
			});
		}
		try {
			const config = await setShortcutBindingRpc(action, accelerator);
			if (config) set({ config });
		} catch (e) {
			if (prev) set({ config: prev });
			logError("Couldn't change the shortcut.", {
				source: "settings",
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	},

	setAppearance: async (patch) => {
		const prev = get().config;
		if (prev) {
			set({ config: { ...prev, appearance: { ...prev.appearance, ...patch } } });
		}
		try {
			const config = await setAppearanceRpc(patch);
			if (config) set({ config });
		} catch (e) {
			if (prev) set({ config: prev });
			logError("Couldn't change the appearance.", {
				source: "settings",
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	},

	setConfig: (config) => set({ config }),
	setWebgpuAvailable: (available) => set({ webgpuAvailable: available }),
}));

/**
 * Where speech synthesis should run. Until the settings are hydrated (and in
 * a plain browser, where they never are) that is the CPU, never the GPU.
 */
export function ttsBackendPreference(): TtsBackend {
	return useAppSettingsStore.getState().config?.ttsBackend ?? "cpu";
}

/** Configured max characters per TTS chunk (defaults until hydrated). */
export function getMaxChunkChars(): number {
	return (
		useAppSettingsStore.getState().config?.appearance.maxChunkChars ??
		MAX_CHUNK_CHARS_DEFAULT
	);
}

/** Largest selectable CPU thread count: logical cores − 1 (min 1). */
export function maxCpuThreads(): number {
	const cores =
		typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
	return maxSelectableCpuThreads(cores);
}

/**
 * Effective CPU (wasm) thread count. 0/undefined preference = auto, which caps
 * at 4 (see cpuThreads.ts — more wasm threads hurt this small model). Any
 * explicit slider value is clamped to the selectable max, not the auto cap.
 */
export function effectiveCpuThreads(): number {
	const cores =
		typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
	const pref = useAppSettingsStore.getState().config?.cpuThreads ?? 0;
	if (pref && pref > 0) return Math.min(pref, maxCpuThreads());
	return autoCpuThreads(cores);
}
