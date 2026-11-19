import { useEffect } from "react";
import { useAppSettingsStore } from "../settings/appSettingsStore";
import { useTtsStore } from "../tts";
import type { LoadedDocument } from "../types";

/**
 * Tells the main process what is playing, for the tray icon's tooltip and
 * menu. Only while "Keep playing when the window is closed" is on. Renders
 * nothing.
 */
export function TrayNowPlayingSync({
	document,
}: {
	document: LoadedDocument | null;
}) {
	const enabled = useAppSettingsStore(
		(s) => s.config?.keepPlayingInBackground === true && s.config.trayAvailable,
	);
	const sentence = useTtsStore((s) => s.chunks[s.currentChunkIndex]?.text ?? "");
	const playing = useTtsStore(
		(s) => s.playback !== "idle" && s.playback !== "paused",
	);
	const title = !document
		? ""
		: document.format === "epub"
			? document.title
			: document.fileName;

	useEffect(() => {
		if (!enabled) return;
		void window.api?.request.setNowPlaying({
			title,
			sentence: title ? sentence : "",
			playing,
		});
	}, [enabled, title, sentence, playing]);

	return null;
}
