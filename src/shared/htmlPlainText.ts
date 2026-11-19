import {
	BLOCK_END_TAG_PATTERN,
	BLOCK_START_TAG_PATTERN,
	EPUB_BLOCK_TAGS,
	EPUB_SKIP_TAGS,
	stripNoTextVoidTags,
	stripSkipTags,
} from "./epubHtmlPolicy";

const ENTITY_MAP: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

export { EPUB_BLOCK_TAGS, EPUB_SKIP_TAGS };

export function decodeHtmlEntities(raw: string): string {
	return raw
		.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
			if (body.startsWith("#x")) {
				const code = Number.parseInt(body.slice(2), 16);
				return Number.isFinite(code) ? String.fromCodePoint(code) : match;
			}
			if (body.startsWith("#")) {
				const code = Number.parseInt(body.slice(1), 10);
				return Number.isFinite(code) ? String.fromCodePoint(code) : match;
			}
			return ENTITY_MAP[body] ?? match;
		})
		.replace(/\u00a0/g, " ");
}

/** Collapse whitespace without trimming ends (used for offset mapping). */
export function finalizePlainTextInner(raw: string): string {
	return (
		raw
			// Match the HTML parser's newline normalization (CRLF / lone CR → LF).
			// The webview DOM has no \r (Chromium normalizes on parse), so the regex
			// path must drop it too or every offset after a CRLF drifts the highlight.
			.replace(/\r\n?/g, "\n")
			// The lookbehind starts each run at its first space: without it a long
			// run with no newline after it is rescanned from every position.
			.replace(/(?<![ \t])[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.replace(/[ \t]{2,}/g, " ")
	);
}

/** Collapse whitespace after tag stripping — shared by regex and DOM walks. */
export function finalizePlainText(raw: string): string {
	return finalizePlainTextInner(raw).trim();
}

/** Use only document body so head/metadata does not shift TTS offsets. */
export function extractBodyHtml(html: string): string {
	const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	return m ? m[1]! : html;
}

/** Strip tags and collapse whitespace for TTS (Bun + webview must stay identical). */
export function htmlToPlainText(html: string): string {
	const body = extractBodyHtml(html);
	let s = body;
	s = stripSkipTags(s);
	s = stripNoTextVoidTags(s);
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(BLOCK_END_TAG_PATTERN, "\n\n");
	// Opening block tags add a space; inline tags add nothing so they don't
	// split a word they're glued inside (drop-caps, styled letters). Must stay
	// identical to the DOM walk in domPlainTextPre.
	s = s.replace(BLOCK_START_TAG_PATTERN, " ");
	s = s.replace(/<[^>]+>/g, "");
	s = decodeHtmlEntities(s);
	return finalizePlainText(s);
}

export type PreToCanonicalMap = {
	canonical: string;
	/** `map[i]` = canonical index for pre index `i`; `map[pre.length]` = canonical length. */
	map: number[];
};

/**
 * Map pre-indices to canonical (TTS) indices without trimming each prefix
 * (trimming prefixes caused cumulative highlight drift through the chapter).
 *
 * `map[i]` must equal `finalizePlainTextInner(pre.slice(0, i)).length` (minus
 * the leading skip, clamped). The naive form re-finalizes every prefix —
 * O(n²), which froze the UI on long chapters. Instead we build the prefix
 * length incrementally: a non-whitespace char always contributes exactly one
 * character (no collapse rule touches it), and a maximal whitespace run is
 * finalized independently (none of the four `finalizePlainTextInner` rules span
 * a non-ws↔ws boundary). A finalized whitespace run is always some newlines
 * (CRLF/CR count as one, spaces before a newline vanish, 3+ collapse to 2)
 * followed by at most one space, so the live run is tracked with counters
 * instead of being re-finalized per character (that was O(w²) on long runs).
 * `htmlPlainText.test.ts` pins this against the naive version.
 */
export function buildPreToCanonicalMap(pre: string): PreToCanonicalMap {
	const innerFull = finalizePlainTextInner(pre);
	const leadingSkip = innerFull.length - innerFull.trimStart().length;
	const canonical = innerFull.trim();
	const canonicalLength = canonical.length;
	const map = new Array<number>(pre.length + 1);

	const clamp = (len: number): number =>
		Math.min(canonicalLength, Math.max(0, len - leadingSkip));

	// `stableLen` is the finalized length of everything before the current
	// trailing whitespace run. In that run: `nl` newlines so far, `pendingCR`
	// when the last char was \r (a following \n joins it), `sp` spaces/tabs
	// since the last newline.
	let stableLen = 0;
	let nl = 0;
	let pendingCR = false;
	let sp = 0;
	map[0] = clamp(0);
	for (let i = 0; i < pre.length; i++) {
		const c = pre[i]!;
		if (c === "\n") {
			if (!pendingCR) nl++;
			pendingCR = false;
			sp = 0;
		} else if (c === "\r") {
			nl++;
			pendingCR = true;
			sp = 0;
		} else if (c === " " || c === "\t") {
			pendingCR = false;
			sp++;
		} else {
			stableLen += Math.min(nl, 2) + (sp > 0 ? 1 : 0) + 1;
			nl = 0;
			pendingCR = false;
			sp = 0;
		}
		const len = stableLen + Math.min(nl, 2) + (sp > 0 ? 1 : 0);
		map[i + 1] = i + 1 < pre.length ? clamp(len) : canonicalLength;
	}

	return { canonical, map };
}

/** Normalize text nodes to match entity decoding in {@link htmlToPlainText}. */
export function normalizeTextNodeContent(raw: string): string {
	return decodeHtmlEntities(raw.replace(/\u00a0/g, " "));
}
