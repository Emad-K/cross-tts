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
