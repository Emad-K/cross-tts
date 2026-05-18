import { useEffect } from "react";
import { pausePlayback, useTtsStore } from "../tts";
import { useSleepTimerStore } from "./sleepTimerStore";

function isPlaybackActiveForSleep(
	playback: ReturnType<typeof useTtsStore.getState>["playback"],
): boolean {
	return (
		playback === "playing" ||
		playback === "buffering" ||
		playback === "loading_model"
	);
}

/** Fires the sleep timer and pauses TTS when the deadline is reached during playback. */
export function SleepTimerEffect() {
	const endTimeMs = useSleepTimerStore((s) => s.endTimeMs);
	const clearTimer = useSleepTimerStore((s) => s.clearTimer);

	useEffect(() => {
		if (endTimeMs == null) return;

		const check = () => {
			if (Date.now() < endTimeMs) return;
			if (isPlaybackActiveForSleep(useTtsStore.getState().playback)) {
				void pausePlayback();
			}
			clearTimer();
		};

		check();
		const id = window.setInterval(check, 500);
		return () => window.clearInterval(id);
	}, [endTimeMs, clearTimer]);

	return null;
}
