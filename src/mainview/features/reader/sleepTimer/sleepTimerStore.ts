import { create } from "zustand";
import { minutesToMs } from "./sleepTimerUtils";

export type SleepTimerMode = "time" | "endOfChapter";

type SleepTimerState = {
	/** Active mode; null when the timer is off. */
	mode: SleepTimerMode | null;
	/** Unix ms when playback should pause (time mode only); null otherwise. */
	endTimeMs: number | null;
	/**
	 * Chapter to pause after (endOfChapter mode). Null means "end of whatever
	 * is playing" — the current chapter, or the document for chapterless TXT.
	 */
	targetChapterId: string | null;
	startTimer: (minutes: number) => void;
	startEndOfChapter: (targetChapterId?: string | null) => void;
	clearTimer: () => void;
};

export const useSleepTimerStore = create<SleepTimerState>((set) => ({
	mode: null,
	endTimeMs: null,
	targetChapterId: null,
	startTimer: (minutes) => {
		if (minutes <= 0) return;
		set({
			mode: "time",
			endTimeMs: Date.now() + minutesToMs(minutes),
			targetChapterId: null,
		});
	},
	startEndOfChapter: (targetChapterId = null) =>
		set({ mode: "endOfChapter", endTimeMs: null, targetChapterId }),
	clearTimer: () =>
		set({ mode: null, endTimeMs: null, targetChapterId: null }),
}));
