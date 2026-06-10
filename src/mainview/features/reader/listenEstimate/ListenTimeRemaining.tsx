import { useMemo } from "react";
import {
	estimateSecondsForChars,
	formatListenRemaining,
	remainingBookChars,
	remainingChapterChars,
} from "@shared/listenTimeEstimate";
import { useListenEstimateStore } from "./listenEstimateStore";
import { useTtsStore } from "../tts";

/**
 * "~Xm left in chapter · ~Xh Ym in book" from the measured synthesis rate.
 * Renders nothing until enough audio has been measured to trust the rate;
 * the book part needs every later chapter's text length (EPUBs, fetched
 * lazily by {@link ListenEstimateSync}) and is omitted until known.
 */
export function ListenTimeRemaining() {
	const chunks = useTtsStore((s) => s.chunks);
	const currentChunkIndex = useTtsStore((s) => s.currentChunkIndex);
	const speed = useTtsStore((s) => s.speed);
	const rate = useListenEstimateStore((s) => s.rate);
	const chapterIds = useListenEstimateStore((s) => s.chapterIds);
	const activeChapterId = useListenEstimateStore((s) => s.activeChapterId);
	const chapterChars = useListenEstimateStore((s) => s.chapterChars);

	const chapterRemainChars = useMemo(
		() =>
			remainingChapterChars(
				chunks.map((c) => c.text.length),
				currentChunkIndex,
			),
		[chunks, currentChunkIndex],
	);

	const bookRemainChars = useMemo(() => {
		if (chapterIds.length < 2 || !activeChapterId) return null;
		const idx = chapterIds.indexOf(activeChapterId);
		if (idx < 0) return null;
		return remainingBookChars({
			chapterCharCounts: chapterIds.map((id) => chapterChars[id]),
			currentChapterIndex: idx,
			remainingCurrentChapterChars: chapterRemainChars,
		});
	}, [chapterIds, activeChapterId, chapterChars, chapterRemainChars]);

	if (chunks.length === 0) return null;

	const chapterSec = estimateSecondsForChars(rate, chapterRemainChars, speed);
	if (chapterSec == null) return null;

	const bookSec =
		bookRemainChars != null
			? estimateSecondsForChars(rate, bookRemainChars, speed)
			: null;

	return (
		<span className="truncate" aria-live="off">
			{`~${formatListenRemaining(chapterSec)} left in chapter`}
			{bookSec != null
				? ` · ~${formatListenRemaining(bookSec)} in book`
				: ""}
		</span>
	);
}
