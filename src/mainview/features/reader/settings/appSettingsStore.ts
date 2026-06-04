import { create } from "zustand";
import type { AppConfigInfo } from "@shared/appConfig";
import {
	getAppConfig,
	setGpuEnabled as setGpuEnabledRpc,
} from "@/lib/desktopBridge";

type AppSettingsState = {
	/** Null until hydrated from the main process (or when running outside Electron). */
	config: AppConfigInfo | null;
	loaded: boolean;
	/** Whether the renderer detected a usable WebGPU adapter. */
	webgpuAvailable: boolean | null;
	hydrate: () => Promise<void>;
	refresh: () => Promise<void>;
	setGpuEnabled: (enabled: boolean) => Promise<void>;
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

	setGpuEnabled: async (enabled) => {
		// Optimistic update so the switch feels instant.
		const prev = get().config;
		if (prev) set({ config: { ...prev, gpuEnabled: enabled } });
		const config = await setGpuEnabledRpc(enabled);
		if (config) set({ config });
	},

	setConfig: (config) => set({ config }),
	setWebgpuAvailable: (available) => set({ webgpuAvailable: available }),
}));

/** True when TTS should attempt the GPU (WebGPU). Defaults to false until hydrated. */
export function isGpuPreferenceEnabled(): boolean {
	return useAppSettingsStore.getState().config?.gpuEnabled ?? false;
}
