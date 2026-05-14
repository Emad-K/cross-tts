import Electrobun, {
	BrowserView,
	BrowserWindow,
	Updater,
} from "electrobun/bun";
import type { AppRpcSchema } from "../shared/appRpc";
import {
	startKokoroHubServer,
	stopKokoroHubServer,
} from "./kokoroHubServer";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

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

const appRpc = BrowserView.defineRPC<AppRpcSchema>({
	handlers: {
		requests: {
			getKokoroHubBaseUrl: () => kokoroHubBaseUrl,
		},
		messages: {},
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

const mainWindow = new BrowserWindow({
	title: "Cross TTS",
	url,
	frame: {
		width: 900,
		height: 700,
		x: 200,
		y: 200,
	},
	rpc: appRpc,
});

void mainWindow;

console.log("Cross TTS started!");
