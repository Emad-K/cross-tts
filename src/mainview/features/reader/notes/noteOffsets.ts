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
