import type { AppConfigInfo, GpuPowerPreference } from "./appConfig";
import type { Appearance } from "./appearance";
import type { ForwardedLogEntry } from "./logEntry";
import type {
	ModelKind,
	ModelProgress,
	ModelStatusMap,
} from "./modelAssets";
import type { ShortcutAction } from "./shortcuts";
import type { UpdateStatus } from "./updateStatus";
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
		/** Choose which GPU to prefer (multi-GPU machines). */
		setGpuPower: {
			params: { power: GpuPowerPreference };
			response: AppConfigInfo;
		};
		/** Names of GPUs Chromium detected (best-effort), for display. */
		getGpuInfo: {
			params: void;
			response: { activeRenderer: string; gpus: string[] };
		};
		/** Per-kind on-disk model status (present + bytes). */
		getModelStatus: {
			params: void;
			response: ModelStatusMap;
		};
		/** Download a model's weights; progress arrives via onModelProgress. */
		downloadModel: {
			params: { kind: ModelKind };
			response: ModelStatusMap;
		};
		/** Set CPU (wasm) inference threads; 0 = auto. */
		setCpuThreads: {
			params: { threads: number };
			response: AppConfigInfo;
		};
		/** Enable/disable OS-global media shortcuts. */
		setShortcutsEnabled: {
			params: { enabled: boolean };
			response: AppConfigInfo;
		};
		/** Enable/disable automatic update checks and downloads. */
		setAutoUpdate: {
			params: { enabled: boolean };
			response: AppConfigInfo;
		};
		/** Rebind one global shortcut action (Electron accelerator string). */
		setShortcutBinding: {
			params: { action: ShortcutAction; accelerator: string };
			response: AppConfigInfo;
		};
		/** Update theme / mode / font (partial patch). */
		setAppearance: {
			params: Partial<Appearance>;
			response: AppConfigInfo;
		};
		/** Pick a destination folder for audiobook export. */
		chooseExportFolder: {
			params: void;
			response: string | null;
		};
		/** Write one audiobook file into a folder. */
		writeAudioFile: {
			params: { dir: string; fileName: string; data: Uint8Array };
			response: { ok: boolean; path: string | null; error?: string };
		};
		/** Whether an audiobook track already exists (used to resume an export). */
		audioFileExists: {
			params: { dir: string; fileName: string };
			response: boolean;
		};
		/** Cover image (data URL) for a book path, or null if none. */
		getBookCover: {
			params: { filePath: string };
			response: string | null;
		};
		/** Find text in the current page; results arrive via onFoundInPage. */
		findInPage: {
			params: { text: string; forward?: boolean; findNext?: boolean };
			response: void;
		};
		/** Clear the current in-page find selection/highlights. */
		stopFindInPage: {
			params: void;
			response: void;
		};
		/** Reveal an arbitrary path in the OS file manager. */
		revealPath: {
			params: { path: string };
			response: void;
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
		/** Manually check for updates (downloads if one is found). */
		checkForUpdates: {
			params: void;
			response: UpdateStatus;
		};
		/** Current update state, for renderers that mount after events fired. */
		getUpdateStatus: {
			params: void;
			response: UpdateStatus;
		};
		/** Restart into a downloaded update. */
		quitAndInstallUpdate: {
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
	/** Absolute OS path of a dropped/picked File (Electron webUtils), "" if unknown. */
	getPathForFile: (file: File) => string;
	/** Subscribe to log entries forwarded from the main process. Returns an unsubscribe fn. */
	onLog: (listener: (entry: ForwardedLogEntry) => void) => () => void;
	/** Subscribe to global-shortcut triggers from the main process. */
	onShortcut: (listener: (action: ShortcutAction) => void) => () => void;
	/** Subscribe to model-download progress from the main process. */
	onModelProgress: (listener: (progress: ModelProgress) => void) => () => void;
	/** Subscribe to in-page find results from the main process. */
	onFoundInPage: (listener: (result: FoundInPageResult) => void) => () => void;
	/** Subscribe to update-status changes from the main process. */
	onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
};

/** Result of an in-page find, mirroring Electron's `found-in-page` event. */
export type FoundInPageResult = {
	/** 1-based index of the currently-active match (0 if none). */
	activeMatchOrdinal: number;
	/** Total number of matches on the page. */
	matches: number;
};
