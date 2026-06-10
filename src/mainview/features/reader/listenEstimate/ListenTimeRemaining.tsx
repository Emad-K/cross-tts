import { useMemo } from "react";
import { formatHms } from "@shared/formatHms";
import {
	estimateSecondsForChars,
	remainingChapterChars,
} from "@shared/listenTimeEstimate";
import { useListenEstimateStore } from "./listenEstimateStore";
import { useTtsStore } from "../tts";

/**
 * "~hh:mm:ss left in chapter" from the measured synthesis rate. Renders
 * nothing until enough audio has been measured to trust the rate.
 */
export function ListenTimeRemaining() {
	const chunks = useTtsStore((s) => s.chunks);
	const currentChunkIndex = useTtsStore((s) => s.currentChunkIndex);
	const speed = useTtsStore((s) => s.speed);
	const rate = useListenEstimateStore((s) => s.rate);

	const chapterRemainChars = useMemo(
		() =>
			remainingChapterChars(
				chunks.map((c) => c.text.length),
				currentChunkIndex,
			),
		[chunks, currentChunkIndex],
	);

	if (chunks.length === 0) return null;

	const chapterSec = estimateSecondsForChars(rate, chapterRemainChars, speed);
	if (chapterSec == null) return null;

	return (
		<span className="truncate" aria-live="off">
			{`~${formatHms(chapterSec)} left in chapter`}
		</span>
	);
}
