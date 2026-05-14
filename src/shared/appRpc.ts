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
		};
		messages: Record<string, never>;
	};
	webview: {
		requests: Record<string, never>;
		messages: Record<string, never>;
	};
};
