import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppApi, FoundInPageResult } from "../shared/appRpc";
import type { CrashRecord } from "../shared/crashReport";
import type { ForwardedLogEntry } from "../shared/logEntry";
import type { ModelProgress } from "../shared/modelAssets";
import type { ShortcutAction } from "../shared/shortcuts";
import type { UpdateStatus } from "../shared/updateStatus";
import type { WatchedFileCandidate } from "../shared/watchedFolders";

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
		readDocumentBytes: (params) =>
			ipcRenderer.invoke("readDocumentBytes", params),
		readClipboardText: () => ipcRenderer.invoke("readClipboardText"),
		savePastedText: (params) => ipcRenderer.invoke("savePastedText", params),
		exportTtsRulesToFile: (params) =>
			ipcRenderer.invoke("exportTtsRulesToFile", params),
		readUserData: (params) => ipcRenderer.invoke("readUserData", params),
		writeUserData: (params) => ipcRenderer.invoke("writeUserData", params),
		exportTextFile: (params) => ipcRenderer.invoke("exportTextFile", params),
		getAppConfig: () => ipcRenderer.invoke("getAppConfig"),
		setTtsBackend: (params) => ipcRenderer.invoke("setTtsBackend", params),
		cudaAddonInstall: () => ipcRenderer.invoke("cudaAddonInstall"),
		cudaAddonCancel: () => ipcRenderer.invoke("cudaAddonCancel"),
		cudaAddonRemove: () => ipcRenderer.invoke("cudaAddonRemove"),
		setGpuPower: (params) => ipcRenderer.invoke("setGpuPower", params),
		getGpuInfo: () => ipcRenderer.invoke("getGpuInfo"),
		getModelStatus: () => ipcRenderer.invoke("getModelStatus"),
		supertonicPresent: () => ipcRenderer.invoke("supertonicPresent"),
		downloadModel: (params) => ipcRenderer.invoke("downloadModel", params),
		removeModel: (params) => ipcRenderer.invoke("removeModel", params),
		setCrashPromptDisabled: (params) =>
			ipcRenderer.invoke("setCrashPromptDisabled", params),
		setWelcomeSeen: (params) => ipcRenderer.invoke("setWelcomeSeen", params),
		setCpuThreads: (params) => ipcRenderer.invoke("setCpuThreads", params),
		setGpuFp16: (params) => ipcRenderer.invoke("setGpuFp16", params),
		setShortcutsEnabled: (params) =>
			ipcRenderer.invoke("setShortcutsEnabled", params),
		setAutoUpdate: (params) => ipcRenderer.invoke("setAutoUpdate", params),
		setShortcutBinding: (params) =>
			ipcRenderer.invoke("setShortcutBinding", params),
		setAppearance: (params) => ipcRenderer.invoke("setAppearance", params),
		chooseExportFolder: () => ipcRenderer.invoke("chooseExportFolder"),
		writeAudioFile: (params) => ipcRenderer.invoke("writeAudioFile", params),
		appendAudioFile: (params) => ipcRenderer.invoke("appendAudioFile", params),
		finishAudioFile: (params) => ipcRenderer.invoke("finishAudioFile", params),
		audioFileExists: (params) =>
			ipcRenderer.invoke("audioFileExists", params),
		getBookCover: (params) => ipcRenderer.invoke("getBookCover", params),
		getBookCoverBytes: (params) =>
			ipcRenderer.invoke("getBookCoverBytes", params),
		getChapterTextLengths: (params) =>
			ipcRenderer.invoke("getChapterTextLengths", params),
		findInPage: (params) => ipcRenderer.invoke("findInPage", params),
		stopFindInPage: () => ipcRenderer.invoke("stopFindInPage"),
		revealPath: (params) => ipcRenderer.invoke("revealPath", params),
		openExternal: (params) => ipcRenderer.invoke("openExternal", params),
		chooseDataDirectory: () => ipcRenderer.invoke("chooseDataDirectory"),
		resetDataDirectory: () => ipcRenderer.invoke("resetDataDirectory"),
		revealDataDirectory: () => ipcRenderer.invoke("revealDataDirectory"),
		relaunchApp: () => ipcRenderer.invoke("relaunchApp"),
		setKeepPlayingInBackground: (params) =>
			ipcRenderer.invoke("setKeepPlayingInBackground", params),
		setNowPlaying: (params) => ipcRenderer.invoke("setNowPlaying", params),
		backupExport: (params) => ipcRenderer.invoke("backupExport", params),
		backupPick: () => ipcRenderer.invoke("backupPick"),
		backupApplySettings: (params) =>
			ipcRenderer.invoke("backupApplySettings", params),
		missingPaths: (params) => ipcRenderer.invoke("missingPaths", params),
		checkForUpdates: () => ipcRenderer.invoke("checkForUpdates"),
		getUpdateStatus: () => ipcRenderer.invoke("getUpdateStatus"),
		quitAndInstallUpdate: () => ipcRenderer.invoke("quitAndInstallUpdate"),
		addWatchedFolder: () => ipcRenderer.invoke("addWatchedFolder"),
		removeWatchedFolder: (params) =>
			ipcRenderer.invoke("removeWatchedFolder", params),
		getWatchedFileCandidates: () =>
			ipcRenderer.invoke("getWatchedFileCandidates"),
		getPendingCrashReports: () =>
			ipcRenderer.invoke("getPendingCrashReports"),
		resolveCrashReports: (params) =>
			ipcRenderer.invoke("resolveCrashReports", params),
		ttsNodeInit: (params) => ipcRenderer.invoke("ttsNodeInit", params),
		ttsNodeGenerate: (params) => ipcRenderer.invoke("ttsNodeGenerate", params),
		ttsNodeStop: (engine) => ipcRenderer.invoke("ttsNodeStop", engine),
	},
	getPathForFile: (file: File) => {
		try {
			return webUtils.getPathForFile(file);
		} catch {
			return "";
		}
	},
	onLog: (listener: (entry: ForwardedLogEntry) => void) => {
		const handler = (_event: unknown, entry: ForwardedLogEntry) =>
			listener(entry);
		ipcRenderer.on("app:log", handler);
		return () => {
			ipcRenderer.removeListener("app:log", handler);
		};
	},
	onShortcut: (listener: (action: ShortcutAction) => void) => {
		const handler = (_event: unknown, action: ShortcutAction) =>
			listener(action);
		ipcRenderer.on("app:shortcut", handler);
		return () => {
			ipcRenderer.removeListener("app:shortcut", handler);
		};
	},
	onModelProgress: (listener: (progress: ModelProgress) => void) => {
		const handler = (_event: unknown, progress: ModelProgress) =>
			listener(progress);
		ipcRenderer.on("app:model-progress", handler);
		return () => {
			ipcRenderer.removeListener("app:model-progress", handler);
		};
	},
	onFoundInPage: (listener: (result: FoundInPageResult) => void) => {
		const handler = (_event: unknown, result: FoundInPageResult) =>
			listener(result);
		ipcRenderer.on("app:found-in-page", handler);
		return () => {
			ipcRenderer.removeListener("app:found-in-page", handler);
		};
	},
	onUpdateStatus: (listener: (status: UpdateStatus) => void) => {
		const handler = (_event: unknown, status: UpdateStatus) =>
			listener(status);
		ipcRenderer.on("app:update-status", handler);
		return () => {
			ipcRenderer.removeListener("app:update-status", handler);
		};
	},
	onWatchedFiles: (listener: (candidates: WatchedFileCandidate[]) => void) => {
		const handler = (_event: unknown, candidates: WatchedFileCandidate[]) =>
			listener(candidates);
		ipcRenderer.on("app:watched-files", handler);
		return () => {
			ipcRenderer.removeListener("app:watched-files", handler);
		};
	},
	onCrashReports: (listener: (records: CrashRecord[]) => void) => {
		const handler = (_event: unknown, records: CrashRecord[]) =>
			listener(records);
		ipcRenderer.on("app:crash-reports", handler);
		return () => {
			ipcRenderer.removeListener("app:crash-reports", handler);
		};
	},
	onTtsNodeProgress: (listener: (value: number) => void) => {
		const handler = (_event: unknown, value: number) => listener(value);
		ipcRenderer.on("app:tts-node-progress", handler);
		return () => {
			ipcRenderer.removeListener("app:tts-node-progress", handler);
		};
	},
	onCudaAddonProgress: (listener) => {
		const handler = (_event: unknown, progress: { loaded: number; total: number }) =>
			listener(progress);
		ipcRenderer.on("app:cuda-addon-progress", handler);
		return () => {
			ipcRenderer.removeListener("app:cuda-addon-progress", handler);
		};
	},
};

contextBridge.exposeInMainWorld("api", api);
