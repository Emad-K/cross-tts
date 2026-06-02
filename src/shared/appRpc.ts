import type { AppSessionFileV1, WebPersistedSlice } from "./appSession";
import type {
	EpubChapterContentResult,
	ReadDocumentResult,
} from "./documentRpc";

/**
 * Fire-and-forget messages the main webview sends for native window chrome.
 */
export type AppWindowChromeMessages = {
	closeWindow: void;
	minimizeWindow: void;
	maximizeWindow: void;
};

/**
 * Bun ↔ main webview RPC.
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
			pickDocument: {
				params: void;
				response: ReadDocumentResult | null;
			};
			readDocumentAtPath: {
				params: { filePath: string };
				response: ReadDocumentResult | null;
			};
			getEpubChapterContent: {
				params: { filePath: string; chapterId: string };
				response: EpubChapterContentResult | null;
			};
			exportTtsRulesToFile: {
				params: { json: string; suggestedFileName: string };
				response: { cancelled: boolean; filePath: string | null };
			};
			/** @deprecated Use pickDocument */
			pickTextDocument: {
				params: void;
				response: Extract<ReadDocumentResult, { format: "txt" }> | null;
			};
			/** @deprecated Use readDocumentAtPath */
			readTextDocumentAtPath: {
				params: { filePath: string };
				response: Extract<ReadDocumentResult, { format: "txt" }> | null;
			};
		};
		messages: AppWindowChromeMessages;
	};
	webview: {
		requests: Record<string, never>;
		messages: AppWindowChromeMessages;
	};
};

/** @deprecated Import from documentRpc */
export type ReadTextDocumentResult = Extract<
	ReadDocumentResult,
	{ format: "txt" }
>;

type AppRequests = AppRpcSchema["bun"]["requests"];
type AppMessages = AppRpcSchema["bun"]["messages"];

/**
 * Typed bridge exposed on `window.api` by the Electron preload script.
 * `request.*` map to `ipcMain.handle` (async); `send.*` map to
 * `ipcMain.on` (fire-and-forget window-chrome messages).
 */
export type AppApi = {
	request: {
		[K in keyof AppRequests]: (
			...args: AppRequests[K]["params"] extends void
				? []
				: [AppRequests[K]["params"]]
		) => Promise<AppRequests[K]["response"]>;
	};
	send: {
		[K in keyof AppMessages]: () => void;
	};
};
