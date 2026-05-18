import { create } from "zustand";
import { minutesToMs } from "./sleepTimerUtils";

type SleepTimerState = {
	/** Unix ms when playback should pause if still active; null when off. */
	endTimeMs: number | null;
	startTimer: (minutes: number) => void;
	clearTimer: () => void;
};

export const useSleepTimerStore = create<SleepTimerState>((set) => ({
	endTimeMs: null,
	startTimer: (minutes) => {
		if (minutes <= 0) return;
		set({ endTimeMs: Date.now() + minutesToMs(minutes) });
	},
	clearTimer: () => set({ endTimeMs: null }),
}));
