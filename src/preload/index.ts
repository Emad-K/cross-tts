import { contextBridge, ipcRenderer } from "electron";
import type { AppApi } from "../shared/appRpc";
import type { ForwardedLogEntry } from "../shared/logEntry";

/**
 * Typed RPC bridge between the renderer and the Electron main process.
 * Requests are awaited via `ipcRenderer.invoke`. The matching handlers are
 * registered in the main process (see `src/bun/index.ts`).
 */
const api: AppApi = {
	request: {
		getKokoroHubBaseUrl: () => ipcRenderer.invoke("getKokoroHubBaseUrl"),
		loadAppSession: () => ipcRenderer.invoke("loadAppSession"),
		saveAppSession: (web) => ipcRenderer.invoke("saveAppSession", web),
		pickDocument: () => ipcRenderer.invoke("pickDocument"),
		readDocumentAtPath: (params) =>
			ipcRenderer.invoke("readDocumentAtPath", params),
		getEpubChapterContent: (params) =>
			ipcRenderer.invoke("getEpubChapterContent", params),
		exportTtsRulesToFile: (params) =>
			ipcRenderer.invoke("exportTtsRulesToFile", params),
		getAppConfig: () => ipcRenderer.invoke("getAppConfig"),
		setGpuEnabled: (params) => ipcRenderer.invoke("setGpuEnabled", params),
		setCpuThreads: (params) => ipcRenderer.invoke("setCpuThreads", params),
		chooseDataDirectory: () => ipcRenderer.invoke("chooseDataDirectory"),
		resetDataDirectory: () => ipcRenderer.invoke("resetDataDirectory"),
		revealDataDirectory: () => ipcRenderer.invoke("revealDataDirectory"),
		relaunchApp: () => ipcRenderer.invoke("relaunchApp"),
	},
	onLog: (listener: (entry: ForwardedLogEntry) => void) => {
		const handler = (_event: unknown, entry: ForwardedLogEntry) =>
			listener(entry);
		ipcRenderer.on("app:log", handler);
		return () => {
			ipcRenderer.removeListener("app:log", handler);
		};
	},
};

contextBridge.exposeInMainWorld("api", api);
