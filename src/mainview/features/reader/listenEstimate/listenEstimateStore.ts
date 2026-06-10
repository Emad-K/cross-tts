import { create } from "zustand";
import {
	addListenRateSample,
	EMPTY_LISTEN_RATE,
	type ListenRateState,
} from "@shared/listenTimeEstimate";

type ListenEstimateState = {
	/** Measured chars→audio-seconds rate; survives book/chapter switches. */
	rate: ListenRateState;
	/** Path of the open book the chapter data below belongs to. */
	bookPath: string | null;
	/** Chapter ids in reading order (EPUB spine); empty for plain text. */
	chapterIds: string[];
	activeChapterId: string | null;
	/** Known plain-text length per chapter id (filled lazily in the background). */
	chapterChars: Record<string, number>;
	recordSample: (chars: number, seconds: number, speed: number) => void;
	setBook: (path: string | null, chapterIds: string[]) => void;
	setActiveChapter: (id: string | null) => void;
	setChapterChars: (id: string, chars: number) => void;
};

export const useListenEstimateStore = create<ListenEstimateState>(
	(set, get) => ({
		rate: EMPTY_LISTEN_RATE,
		bookPath: null,
		chapterIds: [],
		activeChapterId: null,
		chapterChars: {},

		recordSample: (chars, seconds, speed) =>
			set((s) => ({
				rate: addListenRateSample(s.rate, { chars, seconds, speed }),
			})),

		setBook: (path, chapterIds) => {
			if (get().bookPath === path) {
				set({ chapterIds });
				return;
			}
			set({ bookPath: path, chapterIds, chapterChars: {} });
		},

		setActiveChapter: (activeChapterId) => set({ activeChapterId }),

		setChapterChars: (id, chars) =>
			set((s) =>
				s.chapterChars[id] === chars
					? s
					: { chapterChars: { ...s.chapterChars, [id]: chars } },
			),
	}),
);
