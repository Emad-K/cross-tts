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

/** Build a regex-escaped `tag1|tag2|…` alternation for the given tags. */
function tagAlternation(tags: Iterable<string>): string {
	return [...tags]
		.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|");
}

/**
 * Regex: drop void / no-text tags before the generic strip.
 * Derived from {@link EPUB_VOID_NO_TEXT_TAGS} so the regex (TTS) path and the
 * DOM read-along walk can never disagree about which tags add zero characters
 * (the class of bug behind hr/img highlight drift).
 */
const NO_TEXT_VOID_TAG_PATTERN = new RegExp(
	`<(?:${tagAlternation(EPUB_VOID_NO_TEXT_TAGS)})\\b[^>]*\\/?>`,
	"gi",
);

export function stripNoTextVoidTags(html: string): string {
	return html.replace(NO_TEXT_VOID_TAG_PATTERN, "");
}

/**
 * Regex: remove skip-tag subtrees (opening tag + contents + closing tag), then
 * any leftover self-closing skip tags. Mirrors the DOM walk, which drops these
 * elements without descending into them. Derived from {@link EPUB_SKIP_TAGS}.
 */
const SKIP_SUBTREE_PATTERN = new RegExp(
	`<(${tagAlternation(EPUB_SKIP_TAGS)})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
	"gi",
);
const SKIP_VOID_PATTERN = new RegExp(
	`<(?:${tagAlternation(EPUB_SKIP_TAGS)})\\b[^>]*\\/?>`,
	"gi",
);

export function stripSkipTags(html: string): string {
	return html
		.replace(SKIP_SUBTREE_PATTERN, " ")
		.replace(SKIP_VOID_PATTERN, " ");
}

/**
 * Regex: closing block tag → paragraph break. Derived from {@link EPUB_BLOCK_TAGS}
 * so it stays aligned with the DOM walk's `\n\n`-after-block behavior.
 */
export const BLOCK_END_TAG_PATTERN = new RegExp(
	`</(?:${tagAlternation(EPUB_BLOCK_TAGS)})(?:\\s[^>]*)?>`,
	"gi",
);

export function isEpubSkipTag(tag: string): boolean {
	return EPUB_SKIP_TAGS.has(tag);
}

export function isEpubVoidNoTextTag(tag: string): boolean {
	return EPUB_VOID_NO_TEXT_TAGS.has(tag);
}

export function isEpubAllowedRenderTag(tag: string): boolean {
	return EPUB_ALLOWED_RENDER_TAGS.has(tag);
}
