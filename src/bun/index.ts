import {
	appendFileSync,
	existsSync,
	mkdirSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	session,
	shell,
} from "electron";
import {
	APP_INDEX_URL,
	APP_ORIGIN,
	handleAppRequests,
	registerAppScheme,
} from "./appProtocol";
import {
	audioExportPath,
	isAllowedOrigin,
	isInsideRoot,
	urlOrigin,
} from "./securityGuards";
import { APP_SESSION_VERSION } from "../shared/appSession";
import type { AppSessionFileV1, WebPersistedSlice } from "../shared/appSession";
import {
	addWatchedFolder,
	appConfigInfo,
	backendAvailability,
	defaultDataDir,
	dataDir,
	loadAppConfig,
	removeWatchedFolder,
	resetDataDir,
	setAppearance,
	setCpuThreads,
	setDataDir,
	setTtsBackend,
	setCrashPromptDisabled,
	setGpuFp16,
	setGpuPower,
	setShortcutBinding,
	setShortcutsEnabled,
} from "./appConfigStore";
import {
	applyGlobalShortcuts,
	setShortcutTarget,
	unregisterGlobalShortcuts,
} from "./globalShortcuts";
import { downloadModel, modelStatus, removeModel, supertonicPresent } from "./modelDownload";
import type { GpuPowerPreference } from "../shared/appConfig";
import type { Appearance } from "../shared/appearance";
import {
	MODEL_KINDS,
	MODEL_LABEL,
	REMOVABLE_MODEL_KINDS,
	type ModelKind,
} from "../shared/modelAssets";
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
import { registerDocumentInputHandlers } from "./documentInputIpc";
import { registerChapterLengthHandlers } from "./chapterLengths";
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
	setTtsNodeProgressTarget,
	clearTtsNodeGpuCrash,
	stopTtsNode,
	ttsNodeGenerate,
	ttsNodeInit,
} from "./ttsNode";
import type {
	TtsNodeEngine,
	TtsNodeEp,
	TtsNodeGenerateParams,
} from "../shared/ttsNodeRpc";
import {
	cudaAddonDir,
	cudaAddonErrorText,
	installCudaAddon,
	pruneCudaAddons,
	removeCudaAddon,
} from "./cudaAddon";
import { detectCuda, ortBindingDir } from "./cudaSupport";
import {
	initCrashCapture,
	notifyCrashReportsOnLoad,
	pendingCrashReports,
	resolveCrashReports,
} from "./crashReports";

// TEST-ONLY HOOK (e2e/): point Electron's userData at a sandbox directory so
// the Playwright smoke test runs against a clean config/session. Has no effect
// unless the env var is set, which only the e2e harness does, and is ignored in
// packaged builds so it can't redirect a real install's data.
const e2eUserData = process.env["CROSS_TTS_E2E_USER_DATA"];
if (e2eUserData && !app.isPackaged) {
	app.setPath("userData", e2eUserData);
}

// Electron 38+ opens a native Wayland window, and Chromium can't combine that
// with the Vulkan feature set below ("'--ozone-platform=wayland' is not
// compatible with Vulkan"): the window flickers and nothing is readable (GNOME
// Wayland + NVIDIA). The platform is chosen before this script runs, so
// appendSwitch is too late — relaunch once under X11/XWayland, as Electron <38
// ran. An explicit --ozone-platform (e.g. =wayland) opts out.
if (
	process.platform === "linux" &&
	process.env["WAYLAND_DISPLAY"] &&
	// Not commandLine.hasSwitch: Electron injects its auto-picked platform.
	!process.argv.some((a) => a.startsWith("--ozone-platform")) &&
	!e2eUserData
) {
	app.relaunch({
		// An AppImage's execPath lives in its mount, which vanishes on exit.
		execPath: process.env["APPIMAGE"] || process.execPath,
		args: [...process.argv.slice(1), "--ozone-platform=x11"],
	});
	app.exit(0);
}

// Last-resort crash capture, installed as early as possible: records go to
// <dataDir>/crashes/ and the user is asked (opt-in) on the next launch whether
// to report them on GitHub. Nothing is ever sent automatically.
initCrashCapture();

// SharedArrayBuffer (needed by ONNX Runtime's multi-threaded wasm backend, or
// CPU synthesis runs single-threaded and playback lags) is enabled two ways:
//   1. Cross-origin isolation — the renderer is served from the `app://` scheme
//      with COOP/COEP headers (see appProtocol.ts), which guarantees SAB on
//      every platform. This is the reliable path.
//   2. The Chromium feature flag below, as a belt-and-suspenders fallback. It
//      is a deprecated escape hatch that no longer works everywhere, so it can't
//      be relied on alone.
// Both must be set before the app is ready.
// Linux only: Chromium ships WebGPU off here (navigator.gpu is absent and the
// GPU process falls back to software), so CPU/wasm is the only path unless we
// force it on. These flags bring up hardware WebGPU (Vulkan) — verified on
// Wayland + NVIDIA. Windows/macOS already expose WebGPU without them, and
// `ignore-gpu-blocklist` there could force GPU onto genuinely-broken drivers,
// so scope it to Linux.
// A second appendSwitch("enable-features", …) replaces the first rather than
// merging, so all features go in one call.
app.commandLine.appendSwitch(
	"enable-features",
	process.platform === "linux" ? "SharedArrayBuffer,Vulkan" : "SharedArrayBuffer",
);
if (process.platform === "linux") {
	app.commandLine.appendSwitch("enable-unsafe-webgpu");
	app.commandLine.appendSwitch("ignore-gpu-blocklist");
	// No ozone switch: Electron 38+ defaults to --ozone-platform=auto (native
	// Wayland in Wayland sessions), and Chromium dropped --ozone-platform-hint.
}
registerAppScheme();

// Dev-only renderer server (electron-vite); ignored in packaged builds.
const devRendererUrl = app.isPackaged
	? undefined
	: process.env["ELECTRON_RENDERER_URL"];
/** Origins the app's own UI is served from. Anything else is untrusted. */
const TRUSTED_ORIGINS = [APP_ORIGIN, urlOrigin(devRendererUrl ?? "")].filter(
	(o): o is string => o !== null,
);

// The preload exposes `window.api` to whatever page the window shows, so the
// window must never leave the app's own origin (e.g. a link dragged onto it),
// open popups, or embed webviews.
app.on("web-contents-created", (_event, wc) => {
	wc.on("will-navigate", (e, url) => {
		if (!isAllowedOrigin(url, TRUSTED_ORIGINS)) e.preventDefault();
	});
	wc.setWindowOpenHandler(() => ({ action: "deny" }));
	wc.on("will-attach-webview", (e) => e.preventDefault());
});

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
/**
 * Folders the user picked via chooseExportFolder this session. Audiobook
 * writes and revealPath are confined to these. The export folder isn't
 * persisted (the dialog starts empty each time), so in-memory is enough.
 */
const exportRoots = new Set<string>();

type WindowState = Pick<AppSessionFileV1, "window" | "maximized" | "fullScreen">;
/** Last window geometry seen, kept so saves during teardown still have it. */
let lastWindowState: WindowState | null = null;
function snapshotWindowState(): WindowState | null {
	if (!mainWindow || mainWindow.isDestroyed()) return null;
	// Store the *normal* (restored) bounds — getBounds() on a maximized window
	// returns the maximized rect, which restores a few px off-screen.
	const f = mainWindow.getNormalBounds();
	lastWindowState = {
		window: { x: f.x, y: f.y, width: f.width, height: f.height },
		maximized: mainWindow.isMaximized(),
		fullScreen: mainWindow.isFullScreen(),
	};
	return lastWindowState;
}
const EXPORT_DENIED = {
	ok: false,
	path: null,
	error: "Export location not allowed. Choose the folder again.",
};

/** Renderer-supplied native engine id; anything unknown is Kokoro. */
const nodeEngine = (engine: unknown): TtsNodeEngine =>
	engine === "supertonic" ? "supertonic" : "kokoro";

/**
 * Renderer-requested execution provider, limited to what this machine can
 * run (Kokoro only; anything else is the CPU).
 */
function nodeEp(engine: TtsNodeEngine, ep: unknown): TtsNodeEp {
	if (engine !== "kokoro") return "cpu";
	const backends = backendAvailability();
	if (ep === "cuda" && backends.cuda === "ready") return "cuda";
	if (ep === "dml" && backends.dml) return "dml";
	return "cpu";
}

/** Settles once the startup CUDA library lookup is done (cudaSupport.ts). */
let cudaDetected: Promise<string | null> = Promise.resolve(null);

/** The CUDA add-on download in progress, if any (Settings → Voice → Advanced). */
let cudaAddonAbort: AbortController | null = null;

function registerRpcHandlers(): void {
	// Await hub readiness so the renderer never sees a transient null during
	// startup and wrongly commits to the remote HuggingFace + browser cache.
	ipcMain.handle("getKokoroHubBaseUrl", () => kokoroHubReady);
	ipcMain.handle(
		"ttsNodeInit",
		async (_event, params: { engine?: unknown; ep?: unknown } | undefined) => {
			const engine = nodeEngine(params?.engine);
			return ttsNodeInit(
				await kokoroHubReady,
				loadAppConfig().cpuThreads ?? 0,
				engine,
				nodeEp(engine, params?.ep),
				cudaAddonDir(defaultDataDir()),
			);
		},
	);
	ipcMain.handle("ttsNodeGenerate", (_event, params: TtsNodeGenerateParams) =>
		ttsNodeGenerate(params),
	);
	ipcMain.handle("ttsNodeStop", (_event, engine: unknown) =>
		stopTtsNode(nodeEngine(engine)),
	);
	ipcMain.handle("loadAppSession", () => loadAppSessionFile());
	// Must work while the window is tearing down: the renderer flushes a final
	// save on beforeunload/pagehide, which can land after mainWindow is gone.
	// Window geometry then comes from the snapshot taken on "close".
	ipcMain.handle("saveAppSession", (event, web: WebPersistedSlice) => {
		const url = event.senderFrame?.url;
		if (url !== undefined && !isAllowedOrigin(url, TRUSTED_ORIGINS)) return;
		saveAppSessionFile({
			version: APP_SESSION_VERSION,
			...(snapshotWindowState() ??
				lastWindowState ?? { window: null, maximized: false, fullScreen: false }),
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
	registerDocumentInputHandlers(
		(url) => url !== undefined && isAllowedOrigin(url, TRUSTED_ORIGINS),
	);
	ipcMain.handle(
		"exportTtsRulesToFile",
		(
			_event,
			{ json, suggestedFileName }: { json: string; suggestedFileName: string },
		) => exportTtsRulesToFile(mainWindow, json, suggestedFileName),
	);
	// Waits for the CUDA lookup so Settings lists the right backends.
	ipcMain.handle("getAppConfig", async () => {
		await cudaDetected;
		return appConfigInfo();
	});
	ipcMain.handle("setTtsBackend", (_event, { backend }: { backend: unknown }) => {
		setTtsBackend(backend);
		clearTtsNodeGpuCrash();
		return appConfigInfo();
	});
	// The only request the app makes to nuget.org, and only on this click.
	ipcMain.handle("cudaAddonInstall", async (event) => {
		if (backendAvailability().cuda !== "needs-addon" || cudaAddonAbort) {
			return { ok: false, error: "The CUDA add-on can't be installed right now." };
		}
		const abort = new AbortController();
		cudaAddonAbort = abort;
		let lastSent = 0;
		try {
			await installCudaAddon({
				userData: defaultDataDir(),
				bindingDir: ortBindingDir(),
				signal: abort.signal,
				onProgress: (loaded, total) => {
					// About ten updates a second is plenty for a progress bar.
					if (loaded < total && Date.now() - lastSent < 100) return;
					lastSent = Date.now();
					if (!event.sender.isDestroyed()) {
						event.sender.send("app:cuda-addon-progress", { loaded, total });
					}
				},
			});
			mainLog({ level: "info", source: "models", message: "CUDA add-on installed." });
			return { ok: true, config: appConfigInfo() };
		} catch (e) {
			if (!abort.signal.aborted) {
				mainLog({
					level: "error",
					source: "models",
					message: "Couldn't install the CUDA add-on.",
					detail: e instanceof Error ? e.message : String(e),
				});
			}
			return {
				ok: false,
				error: cudaAddonErrorText(e),
				cancelled: abort.signal.aborted,
			};
		} finally {
			cudaAddonAbort = null;
		}
	});
	ipcMain.handle("cudaAddonCancel", () => cudaAddonAbort?.abort());
	ipcMain.handle("cudaAddonRemove", () => {
		// The native engine may have the libraries loaded.
		stopTtsNode();
		if (!cudaAddonAbort) removeCudaAddon(defaultDataDir());
		if (loadAppConfig().ttsBackend === "cuda") setTtsBackend("auto");
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
		const chosen = result.filePaths[0]!;
		exportRoots.add(resolve(chosen));
		return chosen;
	});
	ipcMain.handle(
		"writeAudioFile",
		(
			_event,
			{ dir, fileName, data }: { dir: string; fileName: string; data: Uint8Array },
		) => {
			const path = audioExportPath(dir, fileName, exportRoots);
			if (!path || !(data instanceof Uint8Array)) return EXPORT_DENIED;
			try {
				mkdirSync(dir, { recursive: true });
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
			const path = audioExportPath(dir, fileName, exportRoots);
			if (!path || !(data instanceof Uint8Array)) return EXPORT_DENIED;
			try {
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
		"finishAudioFile",
		(_event, { dir, fileName }: { dir: string; fileName: string }) => {
			const path = audioExportPath(dir, fileName, exportRoots);
			const part = audioExportPath(dir, `${fileName}.part`, exportRoots);
			if (!path || !part) return EXPORT_DENIED;
			try {
				renameSync(part, path);
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
		(_event, { dir, fileName }: { dir: string; fileName: string }) => {
			const path = audioExportPath(dir, fileName, exportRoots);
			return path !== null && existsSync(path);
		},
	);
	ipcMain.handle(
		"getBookCover",
		(_event, { filePath }: { filePath: string }) => getBookCover(filePath),
	);
	ipcMain.handle(
		"getBookCoverBytes",
		(_event, { filePath }: { filePath: string }) => getBookCoverBytes(filePath),
	);
	registerChapterLengthHandlers();
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
	// Only ever opens an export folder the user picked, never a file: openPath
	// on a file launches it with its default handler.
	ipcMain.handle("revealPath", (_event, { path }: { path: string }) => {
		if (!isInsideRoot(path, exportRoots)) return;
		try {
			if (!statSync(path).isDirectory()) return;
		} catch {
			return;
		}
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
	ipcMain.handle("supertonicPresent", () => supertonicPresent());
	ipcMain.handle("downloadModel", async (_event, { kind }: { kind: ModelKind }) => {
		if (!MODEL_KINDS.includes(kind)) return modelStatus();
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
				message: `${MODEL_LABEL[kind]} downloaded.`,
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			send(0, 0, true, msg);
			mainLog({
				level: "error",
				source: "models",
				message: `Couldn't download ${MODEL_LABEL[kind]}.`,
				detail: msg,
			});
		}
		return modelStatus();
	});
	ipcMain.handle("removeModel", (_event, params: { kind?: unknown } | undefined) => {
		const kind = REMOVABLE_MODEL_KINDS.find((k) => k === params?.kind);
		if (kind) {
			try {
				removeModel(kind);
			} catch (e) {
				mainLog({
					level: "error",
					source: "models",
					message: `Couldn't remove ${MODEL_LABEL[kind]}.`,
					detail: e instanceof Error ? e.message : String(e),
				});
			}
		}
		return modelStatus();
	});
	ipcMain.handle(
		"setCrashPromptDisabled",
		(_event, params: { disabled?: unknown } | undefined) => {
			if (typeof params?.disabled === "boolean") setCrashPromptDisabled(params.disabled);
			return appConfigInfo();
		},
	);
	ipcMain.handle("setCpuThreads", (_event, { threads }: { threads: number }) => {
		setCpuThreads(threads);
		return appConfigInfo();
	});
	ipcMain.handle("setGpuFp16", (_event, { enabled }: { enabled: boolean }) => {
		setGpuFp16(enabled === true);
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

	if (devRendererUrl) {
		void mainWindow.loadURL(devRendererUrl);
	} else {
		void mainWindow.loadURL(APP_INDEX_URL);
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
	setTtsNodeProgressTarget(mainWindow);
	notifyCrashReportsOnLoad(mainWindow);
	applyGlobalShortcuts();
	mainWindow.on("close", () => snapshotWindowState());
	mainWindow.on("closed", () => {
		setLogTarget(null);
		setShortcutTarget(null);
		setUpdateTarget(null);
		setWatchedFilesTarget(null);
		setTtsNodeProgressTarget(null);
		mainWindow = null;
	});
}

app.whenReady().then(async () => {
	// Remove the default application menu (File / Edit / View / …). This app
	// has no menu commands; keyboard accelerators are handled in the renderer.
	Menu.setApplicationMenu(null);

	// Electron grants every permission by default. Deny all except clipboard
	// writes (context-menu "Copy") and choosing an audio output (the player's
	// output picker: lists speakers and their names, never microphones) from
	// the app's own origin. WebGPU, audio playback, mediaSession and
	// findInPage need no permission.
	const allowPermission = (permission: string, url: string) =>
		(permission === "clipboard-sanitized-write" ||
			permission === "speaker-selection") &&
		isAllowedOrigin(url, TRUSTED_ORIGINS);
	session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) =>
		cb(allowPermission(permission, details.requestingUrl)),
	);
	session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) =>
		allowPermission(permission, origin),
	);

	// Serve the built renderer over app:// (with cross-origin-isolation headers)
	// before the window loads it.
	handleAppRequests(join(__dirname, "../renderer"));

	pruneCudaAddons(defaultDataDir());
	cudaDetected = detectCuda();

	registerRpcHandlers();
	createWindow();
	void cudaDetected.then((note) => {
		if (note) mainLog({ level: "info", source: "models", message: note });
	});
	void initAutoUpdate();

	kokoroHubReady = startKokoroHubServer(TRUSTED_ORIGINS)
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
	stopTtsNode();
	stopKokoroHubServer();
	unregisterGlobalShortcuts();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
