import type { AppSessionFileV1, WebPersistedSlice } from "./appSession";

/**
 * Fire-and-forget messages the main webview sends for native window chrome.
 * Declared on both `bun` and `webview` so Electrobun's typed RPC matches wire ids.
 */
export type AppWindowChromeMessages = {
	closeWindow: void;
	minimizeWindow: void;
	maximizeWindow: void;
};

/**
 * Bun ↔ main webview RPC. Bun handles `getKokoroHubBaseUrl` so the renderer can
 * load Hugging Face assets from a disk mirror under the user data directory.
 */
export type AppRpcSchema = {
	bun: {
		requests: {
			getKokoroHubBaseUrl: {
				params: void;
				response: string | null;
			};
			loadAppSession: {
				params: void;
				response: AppSessionFileV1 | null;
			};
			saveAppSession: {
				params: WebPersistedSlice;
				response: void;
			};
		};
		messages: AppWindowChromeMessages;
	};
	webview: {
		requests: Record<string, never>;
		messages: AppWindowChromeMessages;
	};
};
