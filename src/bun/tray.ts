import {
	type BrowserWindow,
	Menu,
	Tray,
	app,
	ipcMain,
	nativeImage,
} from "electron";
import appIcon from "../../assets/linux/icon_256x256.png?asset";
import macIcon from "../../assets/tray/trayTemplate.png?asset";
import { closeAction, trayTooltip } from "../shared/closeBehavior";
import type { ShortcutAction } from "../shared/shortcuts";
import {
	appConfigInfo,
	loadAppConfig,
	setKeepPlayingInBackground,
} from "./appConfigStore";
import { refreshTrayAvailable, trayAvailable } from "./trayAvailability";

/**
 * "Keep playing when the window is closed": a tray icon (menu bar on macOS)
 * with playback controls, and a window that hides instead of closing. The
 * audio lives in the window's renderer, so the window must stay alive.
 */
let tray: Tray | null = null;
let getWindow: () => BrowserWindow | null = () => null;
let quitting = false;
let nowPlaying = { title: "", sentence: "", playing: false };

/** From here on closing the window really closes it. */
export function markQuitting(): void {
	quitting = true;
}

export function showMainWindow(): void {
	const win = getWindow();
	if (!win || win.isDestroyed()) return;
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

function trayIcon() {
	if (process.platform === "darwin") {
		// A 32 px black glyph shown at 16 pt; "template" lets macOS tint it for
		// light and dark menu bars.
		const image = nativeImage.createFromBuffer(
			nativeImage.createFromPath(macIcon).toPNG(),
			{ scaleFactor: 2 },
		);
		image.setTemplateImage(true);
		return image;
	}
	const size = process.platform === "win32" ? 32 : 24;
	return nativeImage.createFromPath(appIcon).resize({ width: size, height: size });
}

/** Same channel as the global media shortcuts, so the renderer needs nothing new. */
function send(action: ShortcutAction): void {
	const wc = getWindow()?.webContents;
	if (wc && !wc.isDestroyed()) wc.send("app:shortcut", action);
}

function refreshMenu(): void {
	if (!tray) return;
	const hasBook = nowPlaying.title.length > 0;
	tray.setContextMenu(
		Menu.buildFromTemplate([
			// Also the "tooltip" on Linux desktops that don't show tray tooltips.
			{
				label: hasBook ? nowPlaying.title.slice(0, 60) : "No book open",
				enabled: false,
			},
			{ type: "separator" },
			{
				label: nowPlaying.playing ? "Pause" : "Play",
				enabled: hasBook,
				click: () => send("playPause"),
			},
			{ label: "Next sentence", enabled: hasBook, click: () => send("nextChunk") },
			{
				label: "Previous sentence",
				enabled: hasBook,
				click: () => send("prevChunk"),
			},
			{ type: "separator" },
			{ label: "Show window", click: showMainWindow },
			{ label: "Quit", click: () => app.quit() },
		]),
	);
}

/** Show or remove the tray icon to match the setting and what the desktop can do. */
export function syncTray(): void {
	const want = loadAppConfig().keepPlayingInBackground && trayAvailable();
	if (want && !tray) {
		try {
			tray = new Tray(trayIcon());
		} catch {
			// No icon means closing the window quits, as it always did.
			tray = null;
			return;
		}
		// macOS opens the menu on click; elsewhere a click brings the window back.
		if (process.platform !== "darwin") tray.on("click", showMainWindow);
		tray.setToolTip(trayTooltip(nowPlaying));
		refreshMenu();
	} else if (!want && tray) {
		tray.destroy();
		tray = null;
	}
}

/**
 * Ask the desktop again whether it has a tray, then match the icon to the
 * answer. Asynchronous: the lookup can take a while on a slow session bus.
 */
export async function refreshTray(): Promise<void> {
	await refreshTrayAvailable();
	syncTray();
}

/**
 * For the window's "close" event: hides the window and returns true when the
 * app should keep playing in the background. Never hides without a tray icon.
 */
export function hideInsteadOfClose(win: BrowserWindow): boolean {
	syncTray();
	const action = closeAction({
		keepPlaying: loadAppConfig().keepPlayingInBackground,
		trayShown: tray !== null,
		quitting,
	});
	if (action === "hide") win.hide();
	return action === "hide";
}

const text = (v: unknown): string => (typeof v === "string" ? v.slice(0, 300) : "");

/** Call once the app is ready. */
export function registerTrayHandlers(window: () => BrowserWindow | null): void {
	getWindow = window;
	app.on("before-quit", markQuitting);
	// Starting the app again brings back a window hidden to the tray.
	app.on("second-instance", showMainWindow);
	ipcMain.handle(
		"setKeepPlayingInBackground",
		(_event, params: { enabled?: unknown } | undefined) => {
			setKeepPlayingInBackground(params?.enabled === true);
			syncTray();
			return appConfigInfo();
		},
	);
	ipcMain.handle(
		"setNowPlaying",
		(
			_event,
			params: { title?: unknown; sentence?: unknown; playing?: unknown } | undefined,
		) => {
			const next = {
				title: text(params?.title),
				sentence: text(params?.sentence),
				playing: params?.playing === true,
			};
			const menuChanged =
				next.title !== nowPlaying.title || next.playing !== nowPlaying.playing;
			nowPlaying = next;
			tray?.setToolTip(trayTooltip(nowPlaying));
			if (menuChanged) refreshMenu();
		},
	);
	void refreshTray();
}
