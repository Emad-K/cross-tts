import { create } from "zustand";
import {
	addListenRateSample,
	coerceListenRates,
	EMPTY_LISTEN_RATE,
	type ListenRates,
} from "@shared/listenTimeEstimate";
import type { ReaderChapter } from "@shared/readerTypes";

/** Measured rates survive restarts so the estimate is right from the start. */
const RATES_KEY = "cross-tts-listen-rates";

function loadRates(): ListenRates {
	try {
		return coerceListenRates(JSON.parse(localStorage.getItem(RATES_KEY) ?? "{}"));
	} catch {
		return {};
	}
}

type ListenEstimateState = {
	/** Measured chars→audio-seconds rate per voice (see listenRateKey). */
	rates: ListenRates;
	/**
	 * Chapters of the open book in reading order (empty for chapterless
	 * documents) and which one is active. Synced by ListenEstimateSync and
	 * consumed by the sleep timer's chapter targeting.
	 */
	chapters: ReaderChapter[];
	activeChapterId: string | null;
	/** Text length per chapter id of the open book; null until known. */
	chapterChars: Record<string, number> | null;
	recordSample: (
		rateKey: string,
		chars: number,
		seconds: number,
		speed: number,
	) => void;
	setChapters: (chapters: ReaderChapter[]) => void;
	setActiveChapter: (id: string | null) => void;
	setChapterChars: (chapterChars: Record<string, number> | null) => void;
};

export const useListenEstimateStore = create<ListenEstimateState>((set, get) => ({
	rates: loadRates(),
	chapters: [],
	activeChapterId: null,
	chapterChars: null,

	recordSample: (rateKey, chars, seconds, speed) => {
		const prev = get().rates[rateKey] ?? EMPTY_LISTEN_RATE;
		const next = addListenRateSample(prev, { chars, seconds, speed });
		if (next === prev) return;
		const rates = { ...get().rates, [rateKey]: next };
		set({ rates });
		try {
			localStorage.setItem(RATES_KEY, JSON.stringify(rates));
		} catch {
			// Storage full or unavailable: the rate still works for this run.
		}
	},

	setChapters: (chapters) => set({ chapters }),

	setActiveChapter: (activeChapterId) => set({ activeChapterId }),

	setChapterChars: (chapterChars) => set({ chapterChars }),
}));
