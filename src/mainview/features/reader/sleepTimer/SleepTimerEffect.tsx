import { useEffect } from "react";
import { showToast } from "@/components/toast/toastStore";
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

/**
 * Fires the time-based sleep timer: pauses TTS when the deadline is reached
 * during playback. The end-of-chapter mode fires from the chapter-finished
 * handler in ReaderApp instead.
 */
export function SleepTimerEffect() {
	const mode = useSleepTimerStore((s) => s.mode);
	const endTimeMs = useSleepTimerStore((s) => s.endTimeMs);
	const clearTimer = useSleepTimerStore((s) => s.clearTimer);

	useEffect(() => {
		if (mode !== "time" || endTimeMs == null) return;

		const check = () => {
			if (Date.now() < endTimeMs) return;
			if (isPlaybackActiveForSleep(useTtsStore.getState().playback)) {
				void pausePlayback();
				showToast({ title: "Sleep timer — playback paused" });
			}
			clearTimer();
		};

		check();
		const id = window.setInterval(check, 500);
		return () => window.clearInterval(id);
	}, [mode, endTimeMs, clearTimer]);

	return null;
}
