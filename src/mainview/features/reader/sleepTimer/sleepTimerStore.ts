import { create } from "zustand";
import { minutesToMs } from "./sleepTimerUtils";

export type SleepTimerMode = "time" | "endOfChapter";

type SleepTimerState = {
	/** Active mode; null when the timer is off. */
	mode: SleepTimerMode | null;
	/** Unix ms when playback should pause (time mode only); null otherwise. */
	endTimeMs: number | null;
	startTimer: (minutes: number) => void;
	startEndOfChapter: () => void;
	clearTimer: () => void;
};

export const useSleepTimerStore = create<SleepTimerState>((set) => ({
	mode: null,
	endTimeMs: null,
	startTimer: (minutes) => {
		if (minutes <= 0) return;
		set({ mode: "time", endTimeMs: Date.now() + minutesToMs(minutes) });
	},
	startEndOfChapter: () => set({ mode: "endOfChapter", endTimeMs: null }),
	clearTimer: () => set({ mode: null, endTimeMs: null }),
}));
