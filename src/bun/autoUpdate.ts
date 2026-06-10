import { app, dialog, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { IDLE_UPDATE_STATUS, type UpdateStatus } from "../shared/updateStatus";
import { autoUpdatePref, setAutoUpdate } from "./appConfigStore";
import { mainLog } from "./logBridge";

const { autoUpdater } = electronUpdater;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function log(level: "info" | "warn", message: string, detail?: string): void {
	mainLog({ level, source: "update", message, detail });
}

let wired = false;
let timer: ReturnType<typeof setInterval> | null = null;
let targetWindow: BrowserWindow | null = null;
let status: UpdateStatus = IDLE_UPDATE_STATUS;

/** Window that receives `app:update-status` events (cleared on close). */
export function setUpdateTarget(win: BrowserWindow | null): void {
	targetWindow = win;
}

/** Current update state, for renderers that mount after events fired. */
export function getUpdateStatus(): UpdateStatus {
	return status;
}

function setStatus(next: UpdateStatus): void {
	status = next;
	try {
		targetWindow?.webContents.send("app:update-status", status);
	} catch {
		// Window may be mid-teardown; the renderer re-reads on next mount.
	}
}

/** Attach the updater event listeners once (idempotent). */
function wireOnce(): void {
	if (wired) return;
	wired = true;

	autoUpdater.on("checking-for-update", () => {
		setStatus({ state: "checking" });
	});

	autoUpdater.on("update-available", (info) => {
		log("info", `Update ${info.version} available — downloading in the background…`);
		setStatus({ state: "downloading", version: info.version });
	});

	autoUpdater.on("update-not-available", () => {
		log("info", "Cross TTS is up to date.");
		setStatus({ state: "up-to-date" });
	});

	autoUpdater.on("update-downloaded", (info) => {
		log("info", `Update ${info.version} downloaded.`);
		// No native dialog: the renderer shows an in-app "restart to update"
		// notification, and the update installs on quit regardless.
		setStatus({ state: "ready", version: info.version });
	});

	autoUpdater.on("error", (err) => {
		const detail = err instanceof Error ? err.message : String(err);
		log("warn", "Update check failed.", detail);
		setStatus({ state: "error", error: detail });
	});
}

/** Begin background update checks (immediate + every 6h). Idempotent. */
function startChecking(): void {
	if (timer) return;
	wireOnce();
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	const check = () => {
		autoUpdater.checkForUpdates().catch((err: unknown) => {
			log("warn", "Could not check for updates.", err instanceof Error ? err.message : String(err));
		});
	};

	check();
	timer = setInterval(check, SIX_HOURS_MS);
}

/** Stop background checks and don't download/install anything. */
function stopChecking(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
}

/** Start or stop checks to match the saved preference. No-op in dev. */
function applyAutoUpdatePref(): void {
	if (!app.isPackaged) return;
	if (autoUpdatePref() === true) startChecking();
	else stopChecking();
}

/**
 * User-initiated check from Settings. Works even with automatic updates off:
 * the user asked for this update, so it downloads and installs on quit (a
 * one-shot — the background check loop stays off unless the pref is on).
 */
export function checkForUpdatesNow(): UpdateStatus {
	if (!app.isPackaged) {
		setStatus({
			state: "error",
			error: "Update checks only work in the installed desktop app.",
		});
		return status;
	}
	wireOnce();
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	setStatus({ state: "checking" });
	autoUpdater.checkForUpdates().catch((err: unknown) => {
		const detail = err instanceof Error ? err.message : String(err);
		log("warn", "Could not check for updates.", detail);
		setStatus({ state: "error", error: detail });
	});
	return status;
}

/** Restart into the downloaded update (renderer "Restart now" action). */
export function quitAndInstallUpdate(): void {
	setImmediate(() => autoUpdater.quitAndInstall());
}

/**
 * Persist a new auto-update choice and apply it immediately. Called from the
 * Settings toggle so enabling kicks off a check right away and disabling halts
 * the background loop without needing a relaunch.
 */
export function setAutoUpdateEnabled(enabled: boolean): void {
	setAutoUpdate(enabled);
	applyAutoUpdatePref();
}

/**
 * Wire GitHub-based auto-updates. Only runs in a packaged build (no-op in dev).
 * On first launch the user hasn't chosen yet (preference is null) — ask once,
 * persist the answer, then honor it. When enabled, new versions download in the
 * background and the renderer offers a restart-to-install.
 */
export async function initAutoUpdate(): Promise<void> {
	if (!app.isPackaged) return;

	if (autoUpdatePref() === null) {
		const result = await dialog
			.showMessageBox({
				type: "question",
				buttons: ["Enable automatic updates", "Not now"],
				defaultId: 0,
				cancelId: 1,
				title: "Automatic updates",
				message: "Keep Cross TTS up to date automatically?",
				detail:
					"New versions download in the background and install when you restart. " +
					"You can change this anytime in Settings → Updates.",
			})
			.catch(() => null);
		setAutoUpdate(result?.response === 0);
	}

	applyAutoUpdatePref();
}
