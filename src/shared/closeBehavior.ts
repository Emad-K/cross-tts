/**
 * What closing the main window does. Audio plays in the window's renderer, so
 * "keep playing in the background" means hiding the window instead of closing
 * it. Without a tray icon there would be no way back to a hidden window, so
 * the window only hides when the tray is really there.
 */
export function closeAction(o: {
	/** The "Keep playing when the window is closed" setting. */
	keepPlaying: boolean;
	/** A tray icon exists right now. */
	trayShown: boolean;
	/** The app is quitting (Quit, an update install, the OS shutting down). */
	quitting: boolean;
}): "hide" | "close" {
	return o.keepPlaying && o.trayShown && !o.quitting ? "hide" : "close";
}

/** Longest tooltip Windows shows (the tray API cuts off after 127 chars). */
const MAX_TOOLTIP = 127;

/** Tray tooltip: the book title, then the sentence being read. */
export function trayTooltip(o: { title: string; sentence: string }): string {
	const clean = (s: string) => s.replace(/\s+/g, " ").trim();
	const text = [clean(o.title), clean(o.sentence)].filter(Boolean).join("\n");
	if (!text) return "Cross TTS";
	return text.length > MAX_TOOLTIP ? `${text.slice(0, MAX_TOOLTIP - 1)}…` : text;
}
