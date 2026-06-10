import { formatHms } from "@shared/formatHms";

/** Wall-clock duration from minutes. */
export function minutesToMs(minutes: number): number {
	return minutes * 60 * 1000;
}

/** Format remaining time as zero-padded `hh:mm:ss` (e.g. "00:23:45"). */
export function formatSleepRemaining(ms: number): string {
	return formatHms(Math.max(0, Math.ceil(ms / 1000)));
}

export function parseCustomSleepMinutes(raw: string): number | null {
	const n = Number.parseInt(raw.trim(), 10);
	if (!Number.isFinite(n) || n < 1 || n > 24 * 60) return null;
	return n;
}

/**
 * Whether the end-of-chapter sleep timer should fire now that a chapter has
 * finished playing.
 *
 * - No target chapter (or no chapter structure, e.g. TXT documents): fire —
 *   the timer means "end of whatever is playing", today's behavior.
 * - Target or finished chapter not found in `chapterIds` (stale ids after a
 *   reload): fire — pausing too early beats playing all night.
 * - Otherwise fire when the finished chapter is the target or past it (the
 *   user may have skipped ahead over the target).
 */
export function shouldSleepAtChapterEnd(opts: {
	targetChapterId: string | null;
	/** Chapter ids in reading order; empty when the document has none. */
	chapterIds: string[];
	finishedChapterId: string | null;
}): boolean {
	const { targetChapterId, chapterIds, finishedChapterId } = opts;
	if (targetChapterId == null || chapterIds.length === 0) return true;
	const targetIdx = chapterIds.indexOf(targetChapterId);
	if (targetIdx < 0) return true;
	const finishedIdx =
		finishedChapterId == null ? -1 : chapterIds.indexOf(finishedChapterId);
	if (finishedIdx < 0) return true;
	return finishedIdx >= targetIdx;
}
