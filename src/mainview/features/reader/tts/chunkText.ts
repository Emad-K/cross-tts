export type TtsChunk = {
	index: number;
	/** Text passed to Kokoro (trimmed). */
	text: string;
	/** Inclusive start index in {@link normalizedReaderText}. */
	start: number;
	/** Exclusive end index in {@link normalizedReaderText}. */
	end: number;
};

const MAX_CHARS = 420;

/** Match TxtViewer: normalize newlines only (no trim) so indices line up with on-screen text. */
export function normalizedReaderText(raw: string): string {
	return raw.replace(/\r\n/g, "\n");
}

/**
 * Split document text into speakable chunks with stable character ranges for highlighting.
 */
export function buildTtsChunks(raw: string): TtsChunk[] {
	const full = normalizedReaderText(raw);
	if (!full.trim()) return [];

	const paragraphs: { text: string; start: number }[] = [];
	let searchFrom = 0;
	const paraSep = /\n\n+/g;
	let m: RegExpExecArray | null;
	while ((m = paraSep.exec(full)) !== null) {
		const slice = full.slice(searchFrom, m.index);
		if (slice.length > 0) paragraphs.push({ text: slice, start: searchFrom });
		searchFrom = m.index + m[0].length;
	}
	const tail = full.slice(searchFrom);
	if (tail.length > 0) paragraphs.push({ text: tail, start: searchFrom });

	const pieces: Omit<TtsChunk, "index">[] = [];
	for (const { text: para, start: paraStart } of paragraphs) {
		pieces.push(...splitParagraph(para, paraStart));
	}
	return pieces.map((c, i) => ({ ...c, index: i }));
}

function splitParagraph(para: string, paraStart: number): Omit<TtsChunk, "index">[] {
	const trimmed = para.trim();
	if (!trimmed.length) return [];

	const lead = para.indexOf(trimmed[0]);
	const base = paraStart + lead;

	const chunks: Omit<TtsChunk, "index">[] = [];
	let offset = 0;
	while (offset < trimmed.length) {
		let take = trimmed.length - offset;
		if (take > MAX_CHARS) {
			const window = trimmed.slice(offset, offset + MAX_CHARS);
			const br = lastBreakIndex(window);
			take = br > 0 ? br : MAX_CHARS;
		}
		const rawSlice = trimmed.slice(offset, offset + take);
		const piece = rawSlice.trim();
		if (piece.length > 0) {
			const inner = rawSlice.indexOf(piece);
			const absStart = base + offset + inner;
			chunks.push({
				text: piece,
				start: absStart,
				end: absStart + piece.length,
			});
		}
		offset += take;
	}
	return chunks;
}

function lastBreakIndex(s: string): number {
	const candidates = [
		s.lastIndexOf("\n"),
		s.lastIndexOf(". "),
		s.lastIndexOf("! "),
		s.lastIndexOf("? "),
		s.lastIndexOf("…"),
		s.lastIndexOf(" "),
	];
	const best = Math.max(...candidates);
	return best > s.length * 0.35 ? best + 1 : 0;
}
