import type { AppApi } from "@shared/appRpc";

declare global {
	interface Window {
		/** Typed RPC bridge injected by the Electron preload script. */
		api?: AppApi;
	}
}

export {};
