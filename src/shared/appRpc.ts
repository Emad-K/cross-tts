import type { AppSessionFileV1, WebPersistedSlice } from "./appSession";

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
		messages: Record<string, never>;
	};
	webview: {
		requests: Record<string, never>;
		messages: Record<string, never>;
	};
};
