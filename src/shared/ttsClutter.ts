/**
 * Running headers and footers: short lines (book title, chapter title, "Page
 * 12 of 300") that a PDF or scanned-book conversion repeats on every page.
 * No regex can know a line is repeated, so this is a detector over the whole
 * chapter text. Pure, shared, unit-tested.
 */

/**
 * Id of the builtin rule that switches the detector on. The rule's pattern
 * never matches; it exists so the toggle, its persistence and the audio-cache
 * signature come from the ordinary rules machinery.
 */
export const REPEATED_LINES_RULE_ID = "builtin-clutter-repeated-lines";

/** Longer lines are prose, not headers. */
const MAX_HEADER_CHARS = 80;
/** A line must appear this often to count as a running header. */
const MIN_REPEATS = 4;

/**
 * What makes two header lines "the same": case, spacing and numbers are
 * ignored ("Page 12" = "page 13"). Null for lines that can't be a header:
 * blank, long, without a letter (page numbers have their own rule), or ending
 * like a sentence or quote (so repeated dialogue such as “Yes.” is kept).
 */
function headerKey(line: string): string | null {
	const t = line.trim();
	if (!t || t.length > MAX_HEADER_CHARS) return null;
	if (!/\p{L}/u.test(t) || /[.!?…"”’']$/u.test(t)) return null;
	return t.replace(/\d+/g, "#").replace(/\s+/g, " ").toLowerCase();
}

/** Keys of the lines that repeat often enough to be running headers. */
export function detectRepeatedLines(text: string): Set<string> {
	const counts = new Map<string, number>();
	for (const line of text.split("\n")) {
		const key = headerKey(line);
		if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const repeated = new Set<string>();
	for (const [key, n] of counts) if (n >= MIN_REPEATS) repeated.add(key);
	return repeated;
}

/** `chunkText` without its lines that are running headers. */
export function stripRepeatedLines(
	chunkText: string,
	repeated: ReadonlySet<string>,
): string {
	if (repeated.size === 0) return chunkText;
	return chunkText
		.split("\n")
		.filter((line) => {
			const key = headerKey(line);
			return key == null || !repeated.has(key);
		})
		.join("\n");
}
