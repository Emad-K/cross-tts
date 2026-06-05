import { type BrowserWindow, globalShortcut } from "electron";
import { shortcutBindings, shortcutsEnabled } from "./appConfigStore";
import { mainLog } from "./logBridge";
import { SHORTCUT_ACTIONS } from "../shared/shortcuts";

/**
 * Registers OS-global media shortcuts (active even when the app isn't focused)
 * and forwards each trigger to the renderer over the "app:shortcut" channel.
 * Re-applied whenever the shortcut settings change.
 */
let target: BrowserWindow | null = null;

export function setShortcutTarget(win: BrowserWindow | null): void {
	target = win;
}

export function applyGlobalShortcuts(): void {
	globalShortcut.unregisterAll();
	if (!shortcutsEnabled()) return;

	const bindings = shortcutBindings();
	const failed: string[] = [];
	for (const { id } of SHORTCUT_ACTIONS) {
		const accel = bindings[id];
		if (!accel) continue;
		try {
			const ok = globalShortcut.register(accel, () => {
				const wc = target?.webContents;
				if (wc && !wc.isDestroyed()) wc.send("app:shortcut", id);
			});
			if (!ok) failed.push(`${id} (${accel})`);
		} catch {
			failed.push(`${id} (${accel})`);
		}
	}

	if (failed.length > 0) {
		mainLog({
			level: "warn",
			source: "shortcuts",
			message: "Some global shortcuts couldn't be registered (already in use by another app?).",
			detail: failed.join(", "),
		});
	}
}

export function unregisterGlobalShortcuts(): void {
	globalShortcut.unregisterAll();
}
