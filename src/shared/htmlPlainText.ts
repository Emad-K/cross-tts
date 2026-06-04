import {
	BLOCK_END_TAG_PATTERN,
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
	return raw
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ");
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
	s = s.replace(/<[^>]+>/g, " ");
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
 */
export function buildPreToCanonicalMap(pre: string): PreToCanonicalMap {
	const innerFull = finalizePlainTextInner(pre);
	const leadingSkip = innerFull.length - innerFull.trimStart().length;
	const canonical = innerFull.trim();
	const canonicalLength = canonical.length;
	const map = new Array<number>(pre.length + 1);

	for (let i = 0; i <= pre.length; i++) {
		if (i >= pre.length) {
			map[i] = canonicalLength;
		} else {
			const inner = finalizePlainTextInner(pre.slice(0, i));
			map[i] = Math.min(
				canonicalLength,
				Math.max(0, inner.length - leadingSkip),
			);
		}
	}

	return { canonical, map };
}

/** Normalize text nodes to match entity decoding in {@link htmlToPlainText}. */
export function normalizeTextNodeContent(raw: string): string {
	return decodeHtmlEntities(raw.replace(/\u00a0/g, " "));
}
