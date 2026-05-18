import { sentences as sbdSentences } from "sbd";

export type TtsChunk = {
	index: number;
	/** Text passed to Kokoro (trimmed). */
	text: string;
	/** Inclusive start index in {@link normalizedReaderText}. */
	start: number;
	/** Exclusive end index in {@link normalizedReaderText}. */
	end: number;
};

/** Prefer whole sentences; sub-split only when a sentence exceeds this. */
const MAX_CHARS_IN_CHUNK = 300;

/** Match TxtViewer: normalize newlines only (no trim) so indices line up. */
export function normalizedReaderText(raw: string): string {
	return raw.replace(/\r\n/g, "\n");
}

/**
 * Collect sentence spans from `full`, running `sbd` line-by-line so that
 * newlines between paragraphs never confuse the sentence detector.
 *
 * `sbd` with `preserve_whitespace: true` can bundle multiple sentences into
 * one when newlines appear mid-paragraph (e.g. "Decree.\nFirst, to…").
 * Processing each line independently avoids that while keeping character
 * offsets accurate for highlighting sync.
 */
function collectSentenceSpans(full: string): { start: number; end: number }[] {
	const spans: { start: number; end: number }[] = [];
	const lines = full.split("\n");
	let pos = 0;

	for (const line of lines) {
		const lineStart = pos;
		// Advance past this line and the \n that followed it.
		// The last line has no trailing \n but that's fine — pos just overshoots
		// by 1 beyond full.length, which is never used as an index.
		pos += line.length + 1;

		if (!line.trim()) continue;

		const parts = sbdSentences(line, { preserve_whitespace: true });

		if (parts.length === 0) {
			spans.push({ start: lineStart, end: lineStart + line.length });
			continue;
		}

		// Guard: if sbd mangled the text (shouldn't happen but be safe), fall
		// back to treating the whole line as one span so offsets stay valid.
		if (parts.join("") !== line) {
			spans.push({ start: lineStart, end: lineStart + line.length });
			continue;
		}

		let linePos = 0;
		for (const seg of parts) {
			const start = lineStart + linePos;
			const end = start + seg.length;
			if (end > start) spans.push({ start, end });
			linePos += seg.length;
		}
	}

	return spans;
}

/** Prefer commas / semicolons / colons, then spaces, inside a long clause. */
function clauseBreakWithin(s: string): number {
	const hard = Math.min(s.length, MAX_CHARS_IN_CHUNK);
	const win = s.slice(0, hard);
	const candidates = [
		win.lastIndexOf("; "),
		win.lastIndexOf(": "),
		win.lastIndexOf(", "),
		win.lastIndexOf("—"),
		win.lastIndexOf("–"),
		win.lastIndexOf(" "),
	];
	const best = Math.max(...candidates);
	return best > win.length * 0.22 ? best + 1 : 0;
}

/**
 * Turn an absolute [absStart, absEnd) slice of `full` into one or more trimmed TTS chunks.
 */
function splitLongSentence(
	full: string,
	absStart: number,
	absEnd: number,
): Omit<TtsChunk, "index">[] {
	const slice = full.slice(absStart, absEnd);
	const lead = slice.length - slice.trimStart().length;
	const trail = slice.length - slice.trimEnd().length;
	const t0 = absStart + lead;
	const t1 = absEnd - trail;
	const core = full.slice(t0, t1);
	if (!core.trim()) return [];

	if (core.length <= MAX_CHARS_IN_CHUNK) {
		const t = core.trim();
		if (!t.length) return [];
		const li = core.indexOf(t[0]!);
		const s = t0 + li;
		return [{ text: t, start: s, end: s + t.length }];
	}

	const out: Omit<TtsChunk, "index">[] = [];
	let offset = 0;
	while (offset < core.length) {
		let take = Math.min(MAX_CHARS_IN_CHUNK, core.length - offset);
		if (take < core.length - offset) {
			const win = core.slice(offset, offset + take);
			const br = clauseBreakWithin(win);
			if (br > 0) take = br;
		}
		const rawPiece = core.slice(offset, offset + take);
		const piece = rawPiece.trim();
		if (piece.length > 0) {
			const li = rawPiece.indexOf(piece[0]!);
			const s = t0 + offset + li;
			out.push({ text: piece, start: s, end: s + piece.length });
		}
		offset += take;
	}
	return out;
}

/** Paragraph / block boundaries from {@link htmlToPlainText} (`\n\n` between blocks). */
function blockSpans(full: string): { start: number; end: number }[] {
	const spans: { start: number; end: number }[] = [];
	const re = /\n\n+/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(full)) !== null) {
		if (m.index > last) spans.push({ start: last, end: m.index });
		last = m.index + m[0].length;
	}
	if (last < full.length) spans.push({ start: last, end: full.length });
	if (spans.length === 0 && full.trim()) spans.push({ start: 0, end: full.length });
	return spans;
}

/** Avoid tiny Kokoro utterances by merging with the following chunk when still under the cap. */
function mergeUndersizedChunks(
	full: string,
	pieces: Omit<TtsChunk, "index">[],
): Omit<TtsChunk, "index">[] {
	const MIN_CHUNK_CHARS = 48;
	const MAX_MERGED_CHARS = 300;
	if (pieces.length === 0) return [];

	const out: Omit<TtsChunk, "index">[] = [];
	let acc = { ...pieces[0]! };

	for (let i = 1; i < pieces.length; i++) {
		const n = pieces[i]!;
		if (acc.text.length >= MIN_CHUNK_CHARS) {
			out.push(acc);
			acc = { ...n };
			continue;
		}
		const start = Math.min(acc.start, n.start);
		const end = Math.max(acc.end, n.end);
		const span = full.slice(start, end);
		const text = span.trim();
		if (!text.length) {
			out.push(acc);
			acc = { ...n };
			continue;
		}
		if (text.length > MAX_MERGED_CHARS) {
			out.push(acc);
			acc = { ...n };
			continue;
		}
		const li = span.indexOf(text[0]!);
		acc = { text, start: start + li, end: start + li + text.length };
	}
	out.push(acc);
	return out;
}

/**
 * Split document text into speakable chunks on sentence boundaries when possible.
 */
export function buildTtsChunks(raw: string): TtsChunk[] {
	const full = normalizedReaderText(raw);
	if (!full.trim()) return [];

	const merged: Omit<TtsChunk, "index">[] = [];
	for (const { start: blockStart, end: blockEnd } of blockSpans(full)) {
		const block = full.slice(blockStart, blockEnd);
		if (!block.trim()) continue;

		const spans = collectSentenceSpans(block);
		const pieces: Omit<TtsChunk, "index">[] = [];
		for (const { start, end } of spans) {
			pieces.push(
				...splitLongSentence(
					full,
					blockStart + start,
					blockStart + end,
				),
			);
		}
		merged.push(...mergeUndersizedChunks(full, pieces));
	}
	return merged.map((c, i) => ({ ...c, index: i }));
}
