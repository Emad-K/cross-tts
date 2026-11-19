import { finalizePlainTextInner } from "@shared/htmlPlainText";

/** A read-along chunk's slice of the chapter text. */
type ChunkSpan = { index: number; start: number; end: number };

/**
 * The chunk a chapter-text offset falls in, and the offset inside that chunk.
 * An offset in the whitespace between two chunks snaps forward when it starts a
 * range and back when it ends one, so a range never begins or ends in a gap.
 */
export function locateOffset(
	chunks: readonly ChunkSpan[],
	offset: number,
	bias: "start" | "end",
): { index: number; local: number } | null {
	if (bias === "start") {
		const c = chunks.find((c) => c.end > offset);
		return c ? { index: c.index, local: Math.max(0, offset - c.start) } : null;
	}
	const c = chunks.filter((c) => c.start < offset).at(-1);
	return c
		? { index: c.index, local: Math.min(c.end, offset) - c.start }
		: null;
}

/** Shrink a range so it neither starts nor ends on whitespace; null if nothing is left. */
export function trimRange(
	text: string,
	start: number,
	end: number,
): { start: number; end: number } | null {
	let s = Math.max(0, start);
	let e = Math.min(text.length, end);
	while (s < e && /\s/.test(text[s]!)) s++;
	while (e > s && /\s/.test(text[e - 1]!)) e--;
	return e > s ? { start: s, end: e } : null;
}

/**
 * A chunk's text on screen can be longer than its slice of the chapter text:
 * an EPUB page keeps runs of spaces ("end.  Next", &nbsp;&nbsp;) that the
 * chapter text collapses to one. These two convert an offset inside a chunk
 * between the two, using the same collapsing.
 *
 * ponytail: a chunk that crosses a <br> or block edge has a separator in the
 * chapter text that isn't on screen, so offsets after it are off by that much.
 * Tag each span with its chapter offset if that ever shows.
 */
export function chapterLength(shown: string, upTo = shown.length): number {
	return finalizePlainTextInner(shown.slice(0, upTo)).length;
}

/** Where in a chunk's on-screen text the chapter-text offset `local` falls. */
export function shownOffset(
	shown: string,
	local: number,
	bias: "start" | "end",
): number {
	// Nothing collapsed (every TXT chunk, most EPUB ones): the offsets agree.
	if (chapterLength(shown) === shown.length) return Math.min(local, shown.length);
	// chapterLength grows with `upTo`, so search: a start goes after a
	// collapsed run (last position that fits), an end before it (first).
	let lo = 0;
	let hi = shown.length;
	while (lo < hi) {
		if (bias === "start") {
			const mid = (lo + hi + 1) >> 1;
			if (chapterLength(shown, mid) <= local) lo = mid;
			else hi = mid - 1;
		} else {
			const mid = (lo + hi) >> 1;
			if (chapterLength(shown, mid) >= local) hi = mid;
			else lo = mid + 1;
		}
	}
	return lo;
}
