import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { APP_SESSION_VERSION } from "../shared/appSession";
import type { WebPersistedSlice } from "../shared/appSession";
import {
	appConfigInfo,
	dataDir,
	resetDataDir,
	setDataDir,
	setGpuEnabled,
} from "./appConfigStore";
import {
	loadAppSessionFile,
	pickInitialWindowFrame,
	saveAppSessionFile,
} from "./appSessionStore";
import {
	getEpubChapterContent,
	pickDocument,
	readDocumentAtPath,
} from "./documentIo";
import { exportTtsRulesToFile } from "./ttsRulesIo";
import {
	startKokoroHubServer,
	stopKokoroHubServer,
} from "./kokoroHubServer";

const FALLBACK_FRAME = { width: 900, height: 700, x: 200, y: 200 };

let kokoroHubBaseUrl: string | null = null;
let mainWindow: BrowserWindow | null = null;

function registerRpcHandlers(): void {
	ipcMain.handle("getKokoroHubBaseUrl", () => kokoroHubBaseUrl);
	ipcMain.handle("loadAppSession", () => loadAppSessionFile());
	ipcMain.handle("saveAppSession", (_event, web: WebPersistedSlice) => {
		if (!mainWindow) return;
		const f = mainWindow.getBounds();
		saveAppSessionFile({
			version: APP_SESSION_VERSION,
			window: { x: f.x, y: f.y, width: f.width, height: f.height },
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
	ipcMain.handle("chooseDataDirectory", async () => {
		if (!mainWindow) return null;
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Choose where Cross TTS stores models and data",
			defaultPath: dataDir(),
			properties: ["openDirectory", "createDirectory"],
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		setDataDir(result.filePaths[0]!);
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
			sandbox: false,
		},
	});

	const devUrl = process.env["ELECTRON_RENDERER_URL"];
	if (!app.isPackaged && devUrl) {
		void mainWindow.loadURL(devUrl);
	} else {
		void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}

	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

app.whenReady().then(() => {
	// Remove the default application menu (File / Edit / View / …). This app
	// has no menu commands; keyboard accelerators are handled in the renderer.
	Menu.setApplicationMenu(null);

	try {
		kokoroHubBaseUrl = startKokoroHubServer();
		console.log(`Kokoro hub URL (for webview): ${kokoroHubBaseUrl}`);
	} catch (e) {
		console.warn("Kokoro hub server failed to start; using remote HF:", e);
	}

	registerRpcHandlers();
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});

	console.log("Cross TTS started!");
});

app.on("before-quit", () => {
	stopKokoroHubServer();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
