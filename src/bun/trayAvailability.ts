import { execFileSync } from "node:child_process";
import { app } from "electron";

/**
 * Whether this desktop can show a tray icon. Windows and macOS always can.
 * On Linux the icon needs a StatusNotifier host (KDE, Cinnamon, GNOME with
 * the AppIndicator extension...). Without one Electron creates a tray nobody
 * sees, and a window hidden "to the tray" could never be opened again.
 */
function detect(): boolean {
	// TEST-ONLY HOOK (e2e/): "1"/"0" stands in for a desktop with/without a tray.
	const forced = process.env["CROSS_TTS_E2E_TRAY"];
	if (forced && !app.isPackaged) return forced === "1";
	if (process.platform !== "linux") return true;
	try {
		const out = execFileSync(
			"gdbus",
			[
				"call",
				"--session",
				"--dest=org.freedesktop.DBus",
				"--object-path=/org/freedesktop/DBus",
				"--method=org.freedesktop.DBus.NameHasOwner",
				"org.kde.StatusNotifierWatcher",
			],
			{ encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] },
		);
		return out.includes("true");
	} catch {
		// No gdbus or no session bus: assume no tray; closing then quits as before.
		return false;
	}
}

const RECHECK_MS = 5000;
let known = false;
let checkedAt = 0;

/** Cached; a "no" is re-checked, since the tray host can start after the app. */
export function trayAvailable(): boolean {
	if (!known && Date.now() - checkedAt > RECHECK_MS) {
		known = detect();
		checkedAt = Date.now();
	}
	return known;
}
