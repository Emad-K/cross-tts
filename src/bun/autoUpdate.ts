import { app, dialog } from "electron";
import electronUpdater from "electron-updater";
import { autoUpdatePref, setAutoUpdate } from "./appConfigStore";
import { mainLog } from "./logBridge";

const { autoUpdater } = electronUpdater;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function log(level: "info" | "warn", message: string, detail?: string): void {
	mainLog({ level, source: "update", message, detail });
}

let wired = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Attach the updater event listeners once (idempotent). */
function wireOnce(): void {
	if (wired) return;
	wired = true;

	autoUpdater.on("update-available", (info) => {
		log("info", `Update ${info.version} available — downloading in the background…`);
	});

	autoUpdater.on("update-not-available", () => {
		log("info", "Cross TTS is up to date.");
	});

	autoUpdater.on("update-downloaded", (info) => {
		log("info", `Update ${info.version} downloaded.`);
		void dialog
			.showMessageBox({
				type: "info",
				buttons: ["Restart now", "Later"],
				defaultId: 0,
				cancelId: 1,
				title: "Update ready",
				message: `Cross TTS ${info.version} is ready to install.`,
				detail: "Restart now to update, or it will install when you next quit.",
			})
			.then((result) => {
				if (result.response === 0) {
					setImmediate(() => autoUpdater.quitAndInstall());
				}
			})
			.catch(() => {});
	});

	autoUpdater.on("error", (err) => {
		log("warn", "Update check failed.", err instanceof Error ? err.message : String(err));
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
 * background and offer a restart-to-install. Errors are logged, never thrown.
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
