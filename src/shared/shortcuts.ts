/**
 * Global media shortcuts (work even when the app isn't focused). Accelerators
 * use Electron's syntax; `CommandOrControl` resolves to ⌘ on macOS and Ctrl
 * elsewhere, so the defaults are inherently OS-appropriate.
 */
export type ShortcutAction =
	| "playPause"
	| "nextChunk"
	| "prevChunk"
	| "mute"
	| "volumeDown"
	| "volumeUp";

export const SHORTCUT_ACTIONS: { id: ShortcutAction; label: string }[] = [
	{ id: "playPause", label: "Play / Pause" },
	{ id: "nextChunk", label: "Next sentence" },
	{ id: "prevChunk", label: "Previous sentence" },
	{ id: "volumeUp", label: "Volume up" },
	{ id: "volumeDown", label: "Volume down" },
	{ id: "mute", label: "Mute / Unmute" },
];

export type ShortcutBindings = Record<ShortcutAction, string>;

export function defaultShortcutBindings(): ShortcutBindings {
	return {
		playPause: "CommandOrControl+Shift+Space",
		nextChunk: "CommandOrControl+Shift+Right",
		prevChunk: "CommandOrControl+Shift+Left",
		volumeUp: "CommandOrControl+Shift+Up",
		volumeDown: "CommandOrControl+Shift+Down",
		mute: "CommandOrControl+Shift+M",
	};
}

/** Fill any missing/blank action with its default so the set is always complete. */
export function coerceShortcutBindings(raw: unknown): ShortcutBindings {
	const out = defaultShortcutBindings();
	if (raw && typeof raw === "object") {
		const o = raw as Record<string, unknown>;
		for (const { id } of SHORTCUT_ACTIONS) {
			if (typeof o[id] === "string") out[id] = o[id] as string;
		}
	}
	return out;
}

/** Volume step (percent) for the volume-up/down shortcuts. */
export const SHORTCUT_VOLUME_STEP = 5;
