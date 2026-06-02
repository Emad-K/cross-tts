import { contextBridge, ipcRenderer } from "electron";
import type { AppApi } from "../shared/appRpc";

/**
 * Typed RPC bridge between the renderer and the Electron main process.
 * Requests are awaited via `ipcRenderer.invoke`; window-chrome messages are
 * fire-and-forget via `ipcRenderer.send`. The matching channels are registered
 * in the main process (see `src/bun/index.ts`).
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
		pickTextDocument: () => ipcRenderer.invoke("pickTextDocument"),
		readTextDocumentAtPath: (params) =>
			ipcRenderer.invoke("readTextDocumentAtPath", params),
	},
	send: {
		closeWindow: () => ipcRenderer.send("closeWindow"),
		minimizeWindow: () => ipcRenderer.send("minimizeWindow"),
		maximizeWindow: () => ipcRenderer.send("maximizeWindow"),
	},
};

contextBridge.exposeInMainWorld("api", api);
