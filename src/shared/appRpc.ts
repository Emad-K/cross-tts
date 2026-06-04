import type { AppConfigInfo } from "./appConfig";
import type { AppSessionFileV1, WebPersistedSlice } from "./appSession";
import type {
	EpubChapterContentResult,
	ReadDocumentResult,
} from "./documentRpc";

/**
 * Renderer ↔ main-process RPC schema.
 */
export type AppRpcSchema = {
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
		getAppConfig: {
			params: void;
			response: AppConfigInfo;
		};
		setGpuEnabled: {
			params: { enabled: boolean };
			response: AppConfigInfo;
		};
		/** Open a folder picker; on selection persists the new data dir (needs relaunch to apply). */
		chooseDataDirectory: {
			params: void;
			response: AppConfigInfo | null;
		};
		/** Reset the data directory back to the OS default (needs relaunch to apply). */
		resetDataDirectory: {
			params: void;
			response: AppConfigInfo;
		};
		/** Reveal the current data directory in the OS file manager. */
		revealDataDirectory: {
			params: void;
			response: void;
		};
		/** Restart the app so a new data directory takes effect. */
		relaunchApp: {
			params: void;
			response: void;
		};
	};
};

type AppRequests = AppRpcSchema["requests"];

/**
 * Typed bridge exposed on `window.api` by the Electron preload script.
 * `request.*` map to `ipcMain.handle` (async invoke).
 */
export type AppApi = {
	request: {
		[K in keyof AppRequests]: (
			...args: AppRequests[K]["params"] extends void
				? []
				: [AppRequests[K]["params"]]
		) => Promise<AppRequests[K]["response"]>;
	};
};
