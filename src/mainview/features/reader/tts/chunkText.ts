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
const MAX_CHARS_IN_CHUNK = 160;

/** Match TxtViewer: normalize newlines only (no trim) so indices line up. */
export function normalizedReaderText(raw: string): string {
	return raw.replace(/\r\n/g, "\n");
}

function hasSentenceSegmenter(): boolean {
	return (
		typeof Intl !== "undefined" &&
		"Segmenter" in Intl &&
		typeof (
			Intl as unknown as {
				Segmenter: new (
					locales?: string | string[],
					options?: { granularity?: "sentence" },
				) => {
					segment: (input: string) => Iterable<{
						segment: string;
						index: number;
					}>;
				};
			}
		).Segmenter === "function"
	);
}

/**
 * Sentence spans in `full` using locale-aware boundaries when available.
 */
function collectSentenceSpans(full: string): { start: number; end: number }[] {
	if (hasSentenceSegmenter()) {
		const IntlSeg = (
			Intl as unknown as {
				Segmenter: new (
					locales?: string | string[],
					options?: { granularity?: "sentence" },
				) => {
					segment: (input: string) => Iterable<{
						segment: string;
						index: number;
					}>;
				};
			}
		).Segmenter;
		const seg = new IntlSeg("en", { granularity: "sentence" });
		const spans: { start: number; end: number }[] = [];
		for (const s of seg.segment(full)) {
			const start = s.index;
			const end = start + s.segment.length;
			if (end > start) spans.push({ start, end });
		}
		if (spans.length > 0) return spans;
	}
	return fallbackSentenceSpans(full);
}

/**
 * Sentence-ish spans without `Intl.Segmenter`: punctuation + following closers/space,
 * or blank-line paragraph breaks.
 */
function fallbackSentenceSpans(full: string): { start: number; end: number }[] {
	const n = full.length;
	const spans: { start: number; end: number }[] = [];
	let from = 0;

	const isAbbrevDot = (at: number) => {
		const before = full.slice(Math.max(0, at - 8), at + 1);
		return /\b(mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e)\.$/i.test(before);
	};

	for (let i = 0; i < n; i++) {
		const ch = full[i]!;
		if (ch === "\n" && i + 1 < n && full[i + 1] === "\n") {
			const end = i + 2;
			if (end > from) spans.push({ start: from, end });
			let k = end;
			while (k < n && full[k] === "\n") k++;
			from = k;
			i = k - 1;
			continue;
		}
		if (".!?…。！？".includes(ch) && !isAbbrevDot(i)) {
			let j = i + 1;
			while (j < n && /["'”'»\)\]]/.test(full[j]!)) j++;
			while (j < n && /[\s\u00a0]/.test(full[j]!)) j++;
			if (j > from) spans.push({ start: from, end: j });
			from = j;
			i = j - 1;
		}
	}
	if (from < n) spans.push({ start: from, end: n });
	return spans.filter((s) => s.end > s.start);
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

	const spans = collectSentenceSpans(full);
	const pieces: Omit<TtsChunk, "index">[] = [];
	for (const { start, end } of spans) {
		pieces.push(...splitLongSentence(full, start, end));
	}
	const merged = mergeUndersizedChunks(full, pieces);
	return merged.map((c, i) => ({ ...c, index: i }));
}
