import {
	MAX_CHUNK_CHARS_DEFAULT,
	MAX_CHUNK_CHARS_MAX,
	MAX_CHUNK_CHARS_MIN,
} from "@shared/appearance";
import { getWinkNlp, tokenCharBounds } from "./winkNlp";
import { isSpeakableChunkText } from "./ttsChunkText";

export type TtsChunk = {
	index: number;
	/** Text passed to Kokoro (trimmed). */
	text: string;
	/** Inclusive start index in {@link normalizedReaderText}. */
	start: number;
	/** Exclusive end index in {@link normalizedReaderText}. */
	end: number;
};

/** Match TxtViewer: normalize newlines only (no trim) so indices line up. */
export function normalizedReaderText(raw: string): string {
	return raw.replace(/\r\n/g, "\n");
}

/**
 * Collect sentence spans from `full`, running wink-nlp line-by-line so paragraph
 * newlines are preserved and offsets stay aligned with the source text.
 */
function collectSentenceSpans(full: string): { start: number; end: number }[] {
	const nlp = getWinkNlp();
	const its = nlp.its;
	const spans: { start: number; end: number }[] = [];
	const lines = full.split("\n");
	let pos = 0;

	for (const line of lines) {
		const lineStart = pos;
		pos += line.length + 1;

		if (!line.trim()) continue;

		const doc = nlp.readDoc(line);
		const bounds = tokenCharBounds(doc);

		if (doc.sentences().out().length === 0) {
			spans.push({ start: lineStart, end: lineStart + line.length });
			continue;
		}

		doc.sentences().each((s: { out: (f?: unknown) => unknown }) => {
			const [t0, t1] = s.out(its.span) as [number, number];
			const start = lineStart + (bounds.starts[t0] ?? 0);
			const end = lineStart + (bounds.ends[t1] ?? line.length);
			if (end > start) spans.push({ start, end });
		});
	}

	return spans;
}

/** Prefer commas / semicolons / colons, then spaces, inside a long clause. */
function clauseBreakWithin(s: string, maxChars: number): number {
	const hard = Math.min(s.length, maxChars);
	const win = s.slice(0, hard);
	const min = win.length * 0.22;
	// Prefer the latest punctuation break that fits. Only fall back to a plain
	// space when no clause punctuation qualifies — otherwise a later space always
	// out-ranks an earlier comma and the sentence splits mid-clause.
	const punct = Math.max(
		win.lastIndexOf("; "),
		win.lastIndexOf(": "),
		win.lastIndexOf(", "),
		win.lastIndexOf("—"),
		win.lastIndexOf("–"),
	);
	if (punct > min) return punct + 1;
	const space = win.lastIndexOf(" ");
	return space > min ? space + 1 : 0;
}

/**
 * Turn an absolute [absStart, absEnd) slice of `full` into one or more trimmed TTS chunks.
 */
function splitLongSentence(
	full: string,
	absStart: number,
	absEnd: number,
	maxChars: number,
): Omit<TtsChunk, "index">[] {
	const slice = full.slice(absStart, absEnd);
	const lead = slice.length - slice.trimStart().length;
	const trail = slice.length - slice.trimEnd().length;
	const t0 = absStart + lead;
	const t1 = absEnd - trail;
	const core = full.slice(t0, t1);
	if (!core.trim()) return [];

	if (core.length <= maxChars) {
		const t = core.trim();
		if (!t.length) return [];
		const li = core.indexOf(t[0]!);
		const s = t0 + li;
		return [{ text: t, start: s, end: s + t.length }];
	}

	const out: Omit<TtsChunk, "index">[] = [];
	let offset = 0;
	while (offset < core.length) {
		let take = Math.min(maxChars, core.length - offset);
		if (take < core.length - offset) {
			const win = core.slice(offset, offset + take);
			const br = clauseBreakWithin(win, maxChars);
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
	maxChars: number,
): Omit<TtsChunk, "index">[] {
	const MIN_CHUNK_CHARS = Math.min(48, Math.floor(maxChars / 2));
	const MAX_MERGED_CHARS = maxChars;
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
export function buildTtsChunks(
	raw: string,
	maxChars: number = MAX_CHUNK_CHARS_DEFAULT,
): TtsChunk[] {
	const full = normalizedReaderText(raw);
	if (!full.trim()) return [];
	const cap = Math.max(
		MAX_CHUNK_CHARS_MIN,
		Math.min(
			MAX_CHUNK_CHARS_MAX,
			Math.floor(maxChars) || MAX_CHUNK_CHARS_DEFAULT,
		),
	);

	const merged: Omit<TtsChunk, "index">[] = [];
	for (const { start: blockStart, end: blockEnd } of blockSpans(full)) {
		const block = full.slice(blockStart, blockEnd);
		if (!block.trim()) continue;

		const spans = collectSentenceSpans(block);
		const pieces: Omit<TtsChunk, "index">[] = [];
		for (const { start, end } of spans) {
			pieces.push(
				...splitLongSentence(full, blockStart + start, blockStart + end, cap),
			);
		}
		merged.push(...mergeUndersizedChunks(full, pieces, cap));
	}
	return merged
		.filter((c) => isSpeakableChunkText(c.text))
		.map((c, i) => ({ ...c, index: i }));
}
