import { useEffect, useMemo, useState } from "react";
import { formatClock, formatDurationShort } from "@shared/formatHms";
import {
	bookTimeLeft,
	chapterTimeline,
	listenRateKey,
	secondsPerChar,
} from "@shared/listenTimeEstimate";
import { useListenEstimateStore } from "./listenEstimateStore";
import { useTtsStore } from "../tts";
import { useSweepStore } from "../tts/sweepStore";

/**
 * "12 min left in chapter · 6 h 40 m in book", with the exact
 * "elapsed / total" chapter clock as its tooltip. Elapsed sums the measured
 * audio of every chunk before the current one plus the in-chunk sweep
 * position; everything not yet synthesized is estimated from its text length
 * and the voice's measured chars→seconds rate (a typical rate until the voice
 * has been heard once). The book part needs the chapter lengths, so it appears
 * a moment after a book opens and not at all for chapterless documents.
 */
export function ChapterTime() {
	const chunks = useTtsStore((s) => s.chunks);
	const currentChunkIndex = useTtsStore((s) => s.currentChunkIndex);
	const chunkBaseSec = useTtsStore((s) => s.chunkBaseSec);
	const speed = useTtsStore((s) => s.speed);
	const rateKey = useTtsStore((s) => listenRateKey(s.engineId, s.voice));
	const rate = useListenEstimateStore((s) => s.rates[rateKey]);
	const chapters = useListenEstimateStore((s) => s.chapters);
	const activeChapterId = useListenEstimateStore((s) => s.activeChapterId);
	const chapterChars = useListenEstimateStore((s) => s.chapterChars);

	const timeline = useMemo(
		() =>
			chapterTimeline(
				chunks.map((c) => c.text.length),
				chunkBaseSec,
				rate,
				speed,
			),
		[chunks, chunkBaseSec, rate, speed],
	);

	// The in-chunk sweep updates every animation frame; poll it and round to
	// whole seconds so this component re-renders once per second at most.
	const [elapsedSec, setElapsedSec] = useState(0);
	useEffect(() => {
		if (!timeline) return;
		const compute = () => {
			const start = timeline.starts[currentChunkIndex] ?? timeline.totalSec;
			const end = timeline.starts[currentChunkIndex + 1] ?? timeline.totalSec;
			const intra =
				useTtsStore.getState().playback === "idle"
					? 0
					: useSweepStore.getState().progress;
			return Math.round(
				Math.min(timeline.totalSec, start + intra * Math.max(0, end - start)),
			);
		};
		setElapsedSec(compute());
		const id = setInterval(() => setElapsedSec(compute()), 500);
		return () => clearInterval(id);
	}, [timeline, currentChunkIndex]);

	if (chunks.length === 0 || timeline == null) return null;

	const chapterLeftSec = Math.max(0, timeline.totalSec - elapsedSec);
	const bookLeftSec =
		chapterChars == null
			? null
			: bookTimeLeft({
					chapterIds: chapters.map((c) => c.id),
					chapterChars,
					activeChapterId,
					chapterLeftSec,
					secPerChar: secondsPerChar(rate),
					speed,
				});

	const withHours = timeline.totalSec >= 3600;
	const clock = `${formatClock(elapsedSec, withHours)} / ${formatClock(timeline.totalSec)}`;
	const left = formatDurationShort(chapterLeftSec);
	return (
		<span
			className="truncate tabular-nums"
			aria-live="off"
			title={`Estimated. This chapter: ${clock}`}
		>
			{chapters.length === 0
				? `${left} left`
				: bookLeftSec == null
					? `${left} left in chapter`
					: `${left} left in chapter · ${formatDurationShort(bookLeftSec)} in book`}
		</span>
	);
}
