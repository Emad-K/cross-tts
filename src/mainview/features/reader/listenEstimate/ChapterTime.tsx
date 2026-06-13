import { useEffect, useMemo, useState } from "react";
import { formatClock } from "@shared/formatHms";
import { chapterTimeline } from "@shared/listenTimeEstimate";
import { useListenEstimateStore } from "./listenEstimateStore";
import { useTtsStore } from "../tts";
import { useSweepStore } from "../tts/sweepStore";

/**
 * YouTube-style "elapsed / total" chapter clock. Elapsed sums the measured
 * audio of every chunk before the current one plus the in-chunk sweep
 * position; the total falls back to the measured chars→seconds rate for
 * chunks not yet synthesized. Renders nothing until enough audio has been
 * measured to trust the rate.
 */
export function ChapterTime() {
	const chunks = useTtsStore((s) => s.chunks);
	const currentChunkIndex = useTtsStore((s) => s.currentChunkIndex);
	const chunkBaseSec = useTtsStore((s) => s.chunkBaseSec);
	const speed = useTtsStore((s) => s.speed);
	const rate = useListenEstimateStore((s) => s.rate);

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

	const withHours = timeline.totalSec >= 3600;
	return (
		<span className="truncate tabular-nums" aria-live="off">
			{`${formatClock(elapsedSec, withHours)} / ${formatClock(timeline.totalSec)}`}
		</span>
	);
}
