/**
 * Shared rules for EPUB HTML → plain text, read-along offsets, and sanitization.
 * Bun (TTS) and the webview (render) must stay in sync.
 */

/** Block elements: paragraph break after content in DOM walk / closing tag in regex. */
export const EPUB_BLOCK_TAGS = new Set([
	"p",
	"div",
	"section",
	"article",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li",
	"tr",
	"blockquote",
	"pre",
	"figcaption",
	"dd",
]);

/** Removed entirely from output (no text, no layout in TTS offsets). */
export const EPUB_SKIP_TAGS = new Set([
	"script",
	"style",
	"svg",
	"math",
	"iframe",
	"object",
	"embed",
	"video",
	"audio",
	"canvas",
	"picture",
	"form",
	"noscript",
]);

/**
 * Void / media tags that must not add characters to plain text or offset walks.
 * (Otherwise TTS indices drift vs highlights — e.g. &lt;hr&gt;, &lt;img&gt;.)
 */
export const EPUB_VOID_NO_TEXT_TAGS = new Set([
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"area",
	"col",
	"param",
	"source",
	"track",
	"wbr",
	"base",
]);

/** Tags we may render in the webview (unknown tags are unwrapped). */
export const EPUB_ALLOWED_RENDER_TAGS = new Set([
	...EPUB_BLOCK_TAGS,
	"div",
	"span",
	"em",
	"i",
	"strong",
	"b",
	"u",
	"sub",
	"sup",
	"small",
	"mark",
	"del",
	"ins",
	"a",
	"br",
	"hr",
	"img",
	"ul",
	"ol",
	"dl",
	"dt",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"th",
	"td",
	"caption",
	"figure",
	"ruby",
	"rt",
	"rp",
]);

/** Allowlisted tags for {@link sanitizeEpubHtml} (lowercase). */
export const EPUB_SANITIZE_ALLOWED_TAGS = [
	...EPUB_ALLOWED_RENDER_TAGS,
] as string[];

export const EPUB_SANITIZE_ALLOWED_ATTR = [
	"href",
	"src",
	"alt",
	"title",
	"id",
	"class",
	"lang",
	"dir",
	"colspan",
	"rowspan",
	"epub:type",
] as string[];

/** Regex: drop void/media tags before generic strip (must match EPUB_VOID_NO_TEXT_TAGS). */
const NO_TEXT_VOID_TAG_PATTERN =
	/<(?:hr|img|input|link|meta|area|col|embed|param|source|track|wbr|base|iframe|object|video|audio|canvas|picture)\b[^>]*\/?>/gi;

export function stripNoTextVoidTags(html: string): string {
	return html.replace(NO_TEXT_VOID_TAG_PATTERN, "");
}

export function isEpubSkipTag(tag: string): boolean {
	return EPUB_SKIP_TAGS.has(tag);
}

export function isEpubVoidNoTextTag(tag: string): boolean {
	return EPUB_VOID_NO_TEXT_TAGS.has(tag);
}

export function isEpubAllowedRenderTag(tag: string): boolean {
	return EPUB_ALLOWED_RENDER_TAGS.has(tag);
}
