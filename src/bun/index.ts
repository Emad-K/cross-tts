import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { APP_SESSION_VERSION } from "../shared/appSession";
import type { WebPersistedSlice } from "../shared/appSession";
import {
	addWatchedFolder,
	appConfigInfo,
	dataDir,
	removeWatchedFolder,
	resetDataDir,
	setAppearance,
	setCpuThreads,
	setDataDir,
	setGpuEnabled,
	setGpuPower,
	setShortcutBinding,
	setShortcutsEnabled,
} from "./appConfigStore";
import {
	applyGlobalShortcuts,
	setShortcutTarget,
	unregisterGlobalShortcuts,
} from "./globalShortcuts";
import { downloadModel, modelStatus } from "./modelDownload";
import type { GpuPowerPreference } from "../shared/appConfig";
import type { Appearance } from "../shared/appearance";
import type { ModelKind } from "../shared/modelAssets";
import type { ShortcutAction } from "../shared/shortcuts";
import {
	loadAppSessionFile,
	pickInitialWindowFrame,
	saveAppSessionFile,
} from "./appSessionStore";
import {
	checkForUpdatesNow,
	getUpdateStatus,
	initAutoUpdate,
	quitAndInstallUpdate,
	setAutoUpdateEnabled,
	setUpdateTarget,
} from "./autoUpdate";
import { mainLog, setLogTarget } from "./logBridge";
import {
	getBookCover,
	getBookCoverBytes,
	getEpubChapterContent,
	pickDocument,
	readDocumentAtPath,
} from "./documentIo";
import { exportTtsRulesToFile } from "./ttsRulesIo";
import {
	pushWatchedFiles,
	scanWatchedFolders,
	setWatchedFilesTarget,
} from "./watchedFolders";
import {
	startKokoroHubServer,
	stopKokoroHubServer,
} from "./kokoroHubServer";
import {
	initCrashCapture,
	notifyCrashReportsOnLoad,
	pendingCrashReports,
	resolveCrashReports,
} from "./crashReports";

// TEST-ONLY HOOK (e2e/): point Electron's userData at a sandbox directory so
// the Playwright smoke test runs against a clean config/session. Has no effect
// unless the env var is set, which only the e2e harness does.
const e2eUserData = process.env["CROSS_TTS_E2E_USER_DATA"];
if (e2eUserData) {
	app.setPath("userData", e2eUserData);
}

// Last-resort crash capture, installed as early as possible: records go to
// <dataDir>/crashes/ and the user is asked (opt-in) on the next launch whether
// to report them on GitHub. Nothing is ever sent automatically.
initCrashCapture();

// Re-enable SharedArrayBuffer without requiring cross-origin isolation. ONNX
// Runtime's multi-threaded wasm backend needs SAB; without this it silently
// runs single-threaded and CPU synthesis is painfully slow. Must be set before
// the app is ready.
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");

const FALLBACK_FRAME = { width: 900, height: 700, x: 200, y: 200 };

const GPU_VENDORS: Record<number, string> = {
	0x10de: "NVIDIA",
	0x8086: "Intel",
	0x1002: "AMD",
	0x106b: "Apple",
	0x5143: "Qualcomm",
	0x13b5: "ARM",
};

/** Best-effort GPU names from Chromium. WebGPU itself can't name-select. */
async function getGpuInfo(): Promise<{ activeRenderer: string; gpus: string[] }> {
	try {
		const info = (await app.getGPUInfo("complete")) as {
			auxAttributes?: { glRenderer?: string };
			gpuDevice?: { vendorId?: number; deviceId?: number; active?: boolean }[];
		};
		const activeRenderer = info.auxAttributes?.glRenderer ?? "";
		// Dedup by physical card (vendorId:deviceId). WSL2/Chromium can report the
		// same GPU as two gpuDevice entries (one active, one not) under D3D12/Vulkan
		// passthrough; a name-only Set keeps both because their labels differ.
		const byCard = new Map<string, string>();
		let unkeyed = 0;
		for (const d of info.gpuDevice ?? []) {
			const vendor = (d.vendorId !== undefined && GPU_VENDORS[d.vendorId]) || "GPU";
			const name =
				d.active && activeRenderer
					? activeRenderer
					: d.deviceId !== undefined
						? `${vendor} (0x${d.deviceId.toString(16)})`
						: vendor;
			const key =
				d.vendorId !== undefined && d.deviceId !== undefined
					? `${d.vendorId}:${d.deviceId}`
					: `unkeyed:${unkeyed++}`;
			// Active entry carries the real glRenderer name; let it win over the
			// generic "NVIDIA (0x...)" fallback for the same card.
			if (!byCard.has(key) || (d.active && activeRenderer)) byCard.set(key, name);
		}
		return { activeRenderer, gpus: [...byCard.values()] };
	} catch {
		return { activeRenderer: "", gpus: [] };
	}
}

/** Resolves once the hub finished binding (or failed → null). */
let kokoroHubReady: Promise<string | null> = Promise.resolve(null);
let mainWindow: BrowserWindow | null = null;

function registerRpcHandlers(): void {
	// Await hub readiness so the renderer never sees a transient null during
	// startup and wrongly commits to the remote HuggingFace + browser cache.
	ipcMain.handle("getKokoroHubBaseUrl", () => kokoroHubReady);
	ipcMain.handle("loadAppSession", () => loadAppSessionFile());
	ipcMain.handle("saveAppSession", (_event, web: WebPersistedSlice) => {
		if (!mainWindow) return;
		// Store the *normal* (restored) bounds — getBounds() on a maximized window
		// returns the maximized rect, which restores a few px off-screen.
		const f = mainWindow.getNormalBounds();
		saveAppSessionFile({
			version: APP_SESSION_VERSION,
			window: { x: f.x, y: f.y, width: f.width, height: f.height },
			maximized: mainWindow.isMaximized(),
			fullScreen: mainWindow.isFullScreen(),
			web,
		});
	});
	ipcMain.handle("pickDocument", () => pickDocument(mainWindow));
	ipcMain.handle(
		"readDocumentAtPath",
		(_event, { filePath }: { filePath: string }) =>
			readDocumentAtPath(filePath),
	);
	ipcMain.handle(
		"getEpubChapterContent",
		(
			_event,
			{ filePath, chapterId }: { filePath: string; chapterId: string },
		) => getEpubChapterContent(filePath, chapterId),
	);
	ipcMain.handle(
		"exportTtsRulesToFile",
		(
			_event,
			{ json, suggestedFileName }: { json: string; suggestedFileName: string },
		) => exportTtsRulesToFile(mainWindow, json, suggestedFileName),
	);
	ipcMain.handle("getAppConfig", () => appConfigInfo());
	ipcMain.handle("setGpuEnabled", (_event, { enabled }: { enabled: boolean }) => {
		setGpuEnabled(enabled);
		return appConfigInfo();
	});
	ipcMain.handle(
		"setGpuPower",
		(_event, { power }: { power: GpuPowerPreference }) => {
			setGpuPower(power);
			return appConfigInfo();
		},
	);
	ipcMain.handle("setAppearance", (_event, patch: Partial<Appearance>) => {
		setAppearance(patch);
		return appConfigInfo();
	});
	ipcMain.handle("chooseExportFolder", async () => {
		if (!mainWindow) return null;
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Choose where to save the audiobook",
			properties: ["openDirectory", "createDirectory"],
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0]!;
	});
	ipcMain.handle(
		"writeAudioFile",
		(
			_event,
			{ dir, fileName, data }: { dir: string; fileName: string; data: Uint8Array },
		) => {
			try {
				mkdirSync(dir, { recursive: true });
				const path = join(dir, fileName);
				writeFileSync(path, Buffer.from(data));
				return { ok: true, path };
			} catch (e) {
				return {
					ok: false,
					path: null,
					error: e instanceof Error ? e.message : String(e),
				};
			}
		},
	);
	ipcMain.handle(
		"appendAudioFile",
		(
			_event,
			{ dir, fileName, data }: { dir: string; fileName: string; data: Uint8Array },
		) => {
			try {
				const path = join(dir, fileName);
				appendFileSync(path, Buffer.from(data));
				return { ok: true, path };
			} catch (e) {
				return {
					ok: false,
					path: null,
					error: e instanceof Error ? e.message : String(e),
				};
			}
		},
	);
	ipcMain.handle(
		"audioFileExists",
		(_event, { dir, fileName }: { dir: string; fileName: string }) =>
			existsSync(join(dir, fileName)),
	);
	ipcMain.handle(
		"getBookCover",
		(_event, { filePath }: { filePath: string }) => getBookCover(filePath),
	);
	ipcMain.handle(
		"getBookCoverBytes",
		(_event, { filePath }: { filePath: string }) => getBookCoverBytes(filePath),
	);
	ipcMain.handle(
		"findInPage",
		(
			_event,
			{
				text,
				forward,
				findNext,
			}: { text: string; forward?: boolean; findNext?: boolean },
		) => {
			if (!text) return;
			mainWindow?.webContents.findInPage(text, { forward, findNext });
		},
	);
	ipcMain.handle("stopFindInPage", () => {
		mainWindow?.webContents.stopFindInPage("clearSelection");
	});
	ipcMain.handle("revealPath", (_event, { path }: { path: string }) => {
		void shell.openPath(path);
	});
	// Open a link in the user's default browser. Restricted to https so the
	// renderer can never use this to launch file:/protocol handlers.
	ipcMain.handle("openExternal", (_event, { url }: { url: string }) => {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return;
		}
		if (parsed.protocol !== "https:") return;
		void shell.openExternal(parsed.toString());
	});
	ipcMain.handle("getGpuInfo", () => getGpuInfo());
	ipcMain.handle("getModelStatus", () => modelStatus());
	ipcMain.handle("downloadModel", async (_event, { kind }: { kind: ModelKind }) => {
		const send = (loaded: number, total: number, done: boolean, error?: string) => {
			const wc = mainWindow?.webContents;
			if (wc && !wc.isDestroyed()) {
				wc.send("app:model-progress", { kind, loaded, total, done, error });
			}
		};
		try {
			await downloadModel(kind, (loaded, total) => send(loaded, total, false));
			send(1, 1, true);
			mainLog({
				level: "info",
				source: "models",
				message: `${kind === "gpu" ? "GPU" : "CPU"} model downloaded.`,
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			send(0, 0, true, msg);
			mainLog({
				level: "error",
				source: "models",
				message: `Couldn't download the ${kind === "gpu" ? "GPU" : "CPU"} model.`,
				detail: msg,
			});
		}
		return modelStatus();
	});
	ipcMain.handle("setCpuThreads", (_event, { threads }: { threads: number }) => {
		setCpuThreads(threads);
		return appConfigInfo();
	});
	ipcMain.handle(
		"setShortcutsEnabled",
		(_event, { enabled }: { enabled: boolean }) => {
			setShortcutsEnabled(enabled);
			applyGlobalShortcuts();
			return appConfigInfo();
		},
	);
	ipcMain.handle(
		"setAutoUpdate",
		(_event, { enabled }: { enabled: boolean }) => {
			setAutoUpdateEnabled(enabled);
			return appConfigInfo();
		},
	);
	ipcMain.handle("checkForUpdates", () => checkForUpdatesNow());
	ipcMain.handle("getUpdateStatus", () => getUpdateStatus());
	ipcMain.handle("quitAndInstallUpdate", () => {
		quitAndInstallUpdate();
	});
	ipcMain.handle(
		"setShortcutBinding",
		(
			_event,
			{ action, accelerator }: { action: ShortcutAction; accelerator: string },
		) => {
			setShortcutBinding(action, accelerator);
			applyGlobalShortcuts();
			return appConfigInfo();
		},
	);
	ipcMain.handle("chooseDataDirectory", async () => {
		if (!mainWindow) return null;
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Choose where Cross TTS stores models and data",
			defaultPath: dataDir(),
			properties: ["openDirectory", "createDirectory"],
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		const chosen = result.filePaths[0]!;
		try {
			setDataDir(chosen);
		} catch (e) {
			mainLog({
				level: "error",
				source: "storage",
				message: "Couldn't use the selected folder for app data.",
				detail: `${chosen}: ${e instanceof Error ? e.message : String(e)}`,
			});
			return null;
		}
		mainLog({
			level: "info",
			source: "storage",
			message: "Data folder changed. Restart to apply.",
			detail: chosen,
		});
		return appConfigInfo();
	});
	ipcMain.handle("resetDataDirectory", () => {
		resetDataDir();
		return appConfigInfo();
	});
	ipcMain.handle("revealDataDirectory", () => {
		void shell.openPath(dataDir());
	});
	ipcMain.handle("relaunchApp", () => {
		app.relaunch();
		app.exit(0);
	});
	ipcMain.handle("addWatchedFolder", async () => {
		if (!mainWindow) return null;
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Choose a folder to watch for new books",
			properties: ["openDirectory", "createDirectory"],
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		addWatchedFolder(result.filePaths[0]!);
		// Surface anything already in the folder right away.
		pushWatchedFiles();
		return appConfigInfo();
	});
	ipcMain.handle("removeWatchedFolder", (_event, { dir }: { dir: string }) => {
		removeWatchedFolder(dir);
		return appConfigInfo();
	});
	ipcMain.handle("getWatchedFileCandidates", () => scanWatchedFolders());
	ipcMain.handle("getPendingCrashReports", () => pendingCrashReports());
	ipcMain.handle(
		"resolveCrashReports",
		(
			_event,
			params: { action: "report" | "dismiss"; dontAskAgain: boolean },
		) => {
			resolveCrashReports(params);
		},
	);
}

function createWindow(): void {
	const savedSession = loadAppSessionFile();
	const frame = pickInitialWindowFrame(savedSession, FALLBACK_FRAME);

	mainWindow = new BrowserWindow({
		title: "Cross TTS",
		autoHideMenuBar: true,
		x: frame.x,
		y: frame.y,
		width: frame.width,
		height: frame.height,
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			// Preload only uses ipcRenderer/contextBridge, so the OS sandbox is
			// safe to enable for defense-in-depth.
			sandbox: true,
		},
	});

	// Forward in-page find results to the renderer's find bar.
	mainWindow.webContents.on("found-in-page", (_event, result) => {
		mainWindow?.webContents.send("app:found-in-page", {
			activeMatchOrdinal: result.activeMatchOrdinal,
			matches: result.matches,
		});
	});

	const devUrl = process.env["ELECTRON_RENDERER_URL"];
	if (!app.isPackaged && devUrl) {
		void mainWindow.loadURL(devUrl);
	} else {
		void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}

	// Restore maximized / fullscreen state on top of the normal bounds.
	if (savedSession?.fullScreen) {
		mainWindow.setFullScreen(true);
	} else if (savedSession?.maximized) {
		mainWindow.maximize();
	}

	setLogTarget(mainWindow);
	setShortcutTarget(mainWindow);
	setUpdateTarget(mainWindow);
	setWatchedFilesTarget(mainWindow);
	notifyCrashReportsOnLoad(mainWindow);
	applyGlobalShortcuts();
	mainWindow.on("closed", () => {
		setLogTarget(null);
		setShortcutTarget(null);
		setUpdateTarget(null);
		setWatchedFilesTarget(null);
		mainWindow = null;
	});
}

app.whenReady().then(async () => {
	// Remove the default application menu (File / Edit / View / …). This app
	// has no menu commands; keyboard accelerators are handled in the renderer.
	Menu.setApplicationMenu(null);

	registerRpcHandlers();
	createWindow();
	void initAutoUpdate();

	kokoroHubReady = startKokoroHubServer()
		.then((url) => {
			console.log(`Kokoro hub URL (for webview): ${url}`);
			return url;
		})
		.catch((e: unknown) => {
			mainLog({
				level: "warn",
				source: "models",
				message:
					"Local model cache server failed to start; using remote HuggingFace.",
				detail: e instanceof Error ? e.message : String(e),
			});
			return null;
		});
	await kokoroHubReady;

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});

	console.log("Cross TTS started!");
});

app.on("before-quit", () => {
	stopKokoroHubServer();
	unregisterGlobalShortcuts();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
