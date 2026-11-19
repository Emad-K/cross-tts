import { execFile } from "node:child_process";
import { app } from "electron";

/**
 * Whether this desktop can show a tray icon. Windows and macOS always can.
 * On Linux the icon needs a StatusNotifier host (KDE, Cinnamon, GNOME with
 * the AppIndicator extension...). Without one Electron creates a tray nobody
 * sees, and a window hidden "to the tray" could never be opened again.
 */

/** The answer when it needs no lookup, else null. */
function fixedAnswer(): boolean | null {
	// TEST-ONLY HOOK (e2e/): "1"/"0" stands in for a desktop with/without a tray.
	const forced = process.env["CROSS_TTS_E2E_TRAY"];
	if (forced && !app.isPackaged) return forced === "1";
	return process.platform === "linux" ? null : true;
}

/** Asks the session bus without blocking the main process. */
function askSessionBus(): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(
			"gdbus",
			[
				"call",
				"--session",
				"--dest=org.freedesktop.DBus",
				"--object-path=/org/freedesktop/DBus",
				"--method=org.freedesktop.DBus.NameHasOwner",
				"org.kde.StatusNotifierWatcher",
			],
			{ encoding: "utf8", timeout: 1500 },
			// No gdbus or no session bus: assume no tray; closing then quits as before.
			(err, stdout) => resolve(!err && stdout.includes("true")),
		);
	});
}

const RECHECK_MS = 5000;
let known: boolean | null = null;
let checkedAt = 0;
let asking: Promise<boolean> | null = null;

/** The last answer, without looking again. "No" until the first look is back. */
export function trayAvailable(): boolean {
	known ??= fixedAnswer();
	return known ?? false;
}

/**
 * Look again and update the answer. A "yes" is kept; a "no" is re-asked at
 * most every few seconds, since the tray host can start after the app.
 */
export async function refreshTrayAvailable(): Promise<boolean> {
	if (trayAvailable() || Date.now() - checkedAt < RECHECK_MS) return trayAvailable();
	asking ??= askSessionBus().finally(() => {
		asking = null;
	});
	known = await asking;
	checkedAt = Date.now();
	return known;
}
