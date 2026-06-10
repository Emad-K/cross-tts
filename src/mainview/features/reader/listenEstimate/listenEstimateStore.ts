import { create } from "zustand";
import {
	addListenRateSample,
	EMPTY_LISTEN_RATE,
	type ListenRateState,
} from "@shared/listenTimeEstimate";
import type { ReaderChapter } from "@shared/readerTypes";

type ListenEstimateState = {
	/** Measured chars→audio-seconds rate; survives book/chapter switches. */
	rate: ListenRateState;
	/**
	 * Chapters of the open book in reading order (empty for chapterless
	 * documents) and which one is active. Synced by ListenEstimateSync and
	 * consumed by the sleep timer's chapter targeting.
	 */
	chapters: ReaderChapter[];
	activeChapterId: string | null;
	recordSample: (chars: number, seconds: number, speed: number) => void;
	setChapters: (chapters: ReaderChapter[]) => void;
	setActiveChapter: (id: string | null) => void;
};

export const useListenEstimateStore = create<ListenEstimateState>((set) => ({
	rate: EMPTY_LISTEN_RATE,
	chapters: [],
	activeChapterId: null,

	recordSample: (chars, seconds, speed) =>
		set((s) => ({
			rate: addListenRateSample(s.rate, { chars, seconds, speed }),
		})),

	setChapters: (chapters) => set({ chapters }),

	setActiveChapter: (activeChapterId) => set({ activeChapterId }),
}));
