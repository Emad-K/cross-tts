import { app, dialog } from "electron";
import electronUpdater from "electron-updater";
import { mainLog } from "./logBridge";

const { autoUpdater } = electronUpdater;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function log(level: "info" | "warn", message: string, detail?: string): void {
	mainLog({ level, source: "update", message, detail });
}

/**
 * Wire GitHub-based auto-updates. Only runs in a packaged build (no-op in dev).
 * Downloads new versions in the background and offers a restart-to-install once
 * ready. Errors (e.g. unsigned macOS builds, offline) are logged, never thrown.
 */
export function initAutoUpdate(): void {
	if (!app.isPackaged) return;

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

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

	const check = () => {
		autoUpdater.checkForUpdates().catch((err: unknown) => {
			log("warn", "Could not check for updates.", err instanceof Error ? err.message : String(err));
		});
	};

	check();
	setInterval(check, SIX_HOURS_MS);
}
