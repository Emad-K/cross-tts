import { create } from "zustand";
import {
	FINISHED_PROGRESS,
	type ReadingStats,
	addListening,
	coerceReadingStats,
	emptyReadingStats,
	markFinished,
} from "@shared/readingStats";
import { useOpenBookStore } from "../bookData/openBookStore";
import { loadUserData, userDataSaver } from "../bookData/userData";
import { useBookmarksStore } from "../bookmarks/bookmarksStore";
import { useLibraryStore } from "../library/libraryStore";
import { useTtsStore } from "../tts";

/** Local listening counters (mirrors reading-stats.json). Never sent anywhere. */
export const useStatsStore = create<{ stats: ReadingStats }>(() => ({
	stats: emptyReadingStats(),
}));

// Listening time changes every tick; one write every 10 s is plenty.
const saver = userDataSaver("stats", () => useStatsStore.getState().stats, 10_000);

function update(edit: (stats: ReadingStats) => ReadingStats): void {
	const { stats } = useStatsStore.getState();
	const next = edit(stats);
	if (next === stats) return;
	useStatsStore.setState({ stats: next });
	saver.schedule();
}

let loading: Promise<void> | null = null;

/** Load reading-stats.json once at startup, keeping anything counted meanwhile. */
export function loadStats(): Promise<void> {
	// Once only: a second merge would add the loaded totals to themselves.
	loading ??= mergeSavedStats();
	return loading;
}

async function mergeSavedStats(): Promise<void> {
	const loaded = coerceReadingStats(await loadUserData("stats"));
	const counted = useStatsStore.getState().stats;
	let stats = loaded;
	for (const [day, sec] of Object.entries(counted.days)) {
		stats = { ...stats, days: { ...stats.days, [day]: (stats.days[day] ?? 0) + sec } };
	}
	for (const [path, b] of Object.entries(counted.books)) {
		const prev = stats.books[path];
		stats = {
			...stats,
			books: {
				...stats.books,
				[path]: { ...prev, ...b, listenedSec: (prev?.listenedSec ?? 0) + b.listenedSec },
			},
		};
	}
	useStatsStore.setState({ stats });
}

/** Write the counters now (before a backup reads the file). */
export const flushStats = () => saver.flush();

/** Take reading-stats.json as it is on disk now (after a restore rewrote it). */
export async function reloadStats(): Promise<void> {
	const raw = await loadUserData("stats");
	if (raw) useStatsStore.setState({ stats: coerceReadingStats(raw) });
}

const TICK_MS = 30_000;
/** Longest stretch one commit may add: a suspended laptop must not count as listening. */
const MAX_COMMIT_SEC = (TICK_MS / 1000) * 2;

/**
 * Count wall-clock time while audio is actually playing (not paused, loading
 * or buffering), and note when the open book is played to its end.
 * Returns a stop function.
 */
export function startStatsTracker(): () => void {
	let playingSince: number | null = null;

	const commit = () => {
		if (playingSince === null) return;
		const now = performance.now();
		const sec = Math.min(MAX_COMMIT_SEC, (now - playingSince) / 1000);
		playingSince = now;
		// The bookmarks store still names the book that was playing when a
		// document switch stops playback, which is the one to credit.
		const path = useBookmarksStore.getState().currentPath;
		update((s) => addListening(s, path, sec, new Date()));
	};

	const checkFinished = () => {
		const book = useOpenBookStore.getState().book;
		const t = useTtsStore.getState();
		if (!book?.path || t.playback !== "playing" || t.chunks.length === 0) return;
		const lastChapter =
			book.format !== "epub" ||
			book.chapters.at(-1)?.id === useBookmarksStore.getState().currentChapterId;
		const onLastSentence =
			lastChapter && t.currentChunkIndex === t.chunks.length - 1;
		const progress = useLibraryStore.getState().books[book.path]?.progress ?? 0;
		if (onLastSentence || progress >= FINISHED_PROGRESS) {
			const path = book.path;
			update((s) => markFinished(s, path, Date.now()));
		}
	};

	const unsubscribe = useTtsStore.subscribe((s, prev) => {
		const playing = s.playback === "playing";
		if (playing && playingSince === null) playingSince = performance.now();
		if (!playing && playingSince !== null) {
			commit();
			playingSince = null;
		}
		if (s.currentChunkIndex !== prev.currentChunkIndex || s.playback !== prev.playback) {
			checkFinished();
		}
	});
	const timer = setInterval(commit, TICK_MS);
	const onHide = () => {
		commit();
		saver.flush();
	};
	window.addEventListener("pagehide", onHide);

	return () => {
		unsubscribe();
		clearInterval(timer);
		window.removeEventListener("pagehide", onHide);
		commit();
	};
}
