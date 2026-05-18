import Electrobun, {
	BrowserView,
	BrowserWindow,
	Updater,
} from "electrobun/bun";
import { APP_SESSION_VERSION } from "../shared/appSession";
import type { AppRpcSchema } from "../shared/appRpc";
import type { WebPersistedSlice } from "../shared/appSession";
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
import { readTextDocumentAtPath } from "./textDocumentIo";
import {
	startKokoroHubServer,
	stopKokoroHubServer,
} from "./kokoroHubServer";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

const FALLBACK_FRAME = { width: 900, height: 700, x: 200, y: 200 };

let kokoroHubBaseUrl: string | null = null;

try {
	kokoroHubBaseUrl = startKokoroHubServer();
	console.log(`Kokoro hub URL (for webview): ${kokoroHubBaseUrl}`);
} catch (e) {
	console.warn("Kokoro hub server failed to start; using remote HF:", e);
}

Electrobun.events.on("before-quit", () => {
	stopKokoroHubServer();
});

const savedSession = loadAppSessionFile();
const initialFrame = pickInitialWindowFrame(savedSession, FALLBACK_FRAME);

let mainWindow: BrowserWindow | null = null;

const appRpc = BrowserView.defineRPC<AppRpcSchema>({
	handlers: {
		requests: {
			getKokoroHubBaseUrl: () => kokoroHubBaseUrl,
			loadAppSession: () => loadAppSessionFile(),
			saveAppSession: (web: WebPersistedSlice) => {
				if (!mainWindow) return;
				const f = mainWindow.getFrame();
				saveAppSessionFile({
					version: APP_SESSION_VERSION,
					window: {
						x: f.x,
						y: f.y,
						width: f.width,
						height: f.height,
					},
					web,
				});
			},
			pickDocument: () => pickDocument(),
			readDocumentAtPath: ({ filePath }) => readDocumentAtPath(filePath),
			getEpubChapterContent: ({ filePath, chapterId }) =>
				getEpubChapterContent(filePath, chapterId),
			pickTextDocument: async () => {
				const doc = await pickDocument();
				return doc?.format === "txt" ? doc : null;
			},
			readTextDocumentAtPath: ({ filePath }) =>
				readTextDocumentAtPath(filePath),
		},
		messages: {
			closeWindow: () => {
				mainWindow?.close();
			},
			minimizeWindow: () => {
				mainWindow?.minimize();
			},
			maximizeWindow: () => {
				if (!mainWindow) return;
				if (mainWindow.isMaximized()) {
					mainWindow.unmaximize();
				} else {
					mainWindow.maximize();
				}
			},
		},
	},
});

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

// Create the main application window
const url = await getMainViewUrl();

mainWindow = new BrowserWindow({
	title: "Cross TTS",
	url,
	frame: initialFrame,
	// "hidden" forces Titled:false in Electrobun and drops the resize frame on
	// Windows. "hiddenInset" keeps Titled + FullSizeContentView for custom chrome.
	titleBarStyle: "hiddenInset",
	rpc: appRpc,
});

void mainWindow;

console.log("Cross TTS started!");
