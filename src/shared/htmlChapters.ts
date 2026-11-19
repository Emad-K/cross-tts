import sanitizeHtml from "sanitize-html";
import { EPUB_SANITIZE_ALLOWED_TAGS } from "./epubHtmlPolicy";
import { htmlToPlainText } from "./htmlPlainText";

/**
 * Sanitizer for documents that are not EPUBs (local HTML, Word, Markdown).
 * Stricter than the EPUB policy: no images and no `href`/`src` at all, so
 * nothing in the document can point the reader at a file or a server.
 * Scripts, styles and event handlers are dropped by the allowlist, and the
 * text inside <script>, <style> and <title> goes with them.
 */
const TAGS = EPUB_SANITIZE_ALLOWED_TAGS.filter((t) => t !== "img");
const ATTRS = ["title", "lang", "dir", "colspan", "rowspan"];
const OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: TAGS,
	allowedAttributes: Object.fromEntries(TAGS.map((t) => [t, ATTRS])),
	disallowedTagsMode: "discard",
	allowVulnerableTags: false,
	nonTextTags: ["script", "style", "textarea", "option", "noscript", "title"],
};

export function sanitizeDocumentHtml(html: string): string {
	return sanitizeHtml(html, OPTIONS);
}

export type HtmlChapter = {
	id: string;
	title: string;
	/** 0 for a top-level heading, 1 for an h2 under an h1. */
	level: number;
	/** Sanitized HTML, ready to render. */
	html: string;
	/** `htmlToPlainText(html)`: what is read aloud and what highlights index. */
	text: string;
};

const MAX_TITLE_CHARS = 120;
/** More headings than this is not a table of contents; read it as one chapter. */
const MAX_CHAPTERS = 2000;

/**
 * Turn one HTML document into chapters, splitting before every h1 and h2.
 * A document without headings is one chapter named `fallbackTitle`; text
 * before the first heading becomes a chapter of its own with that name.
 *
 * Each piece is sanitized again after the split, because cutting inside a
 * wrapper (`<div><h2>…`) leaves unbalanced tags and the sanitizer's parser
 * closes them.
 */
export function htmlToChapters(rawHtml: string, fallbackTitle: string): HtmlChapter[] {
	const clean = sanitizeDocumentHtml(rawHtml);

	let cuts: { index: number; h1: boolean }[] = [];
	for (const m of clean.matchAll(/<h([12])\b[^>]*>/gi)) {
		cuts.push({ index: m.index, h1: m[1] === "1" });
	}
	if (cuts.length > MAX_CHAPTERS) cuts = [];
	const hasH1 = cuts.some((c) => c.h1);

	const pieces: { raw: string; title: string | null; level: number }[] = [];
	if (cuts.length === 0 || cuts[0]!.index > 0) {
		pieces.push({ raw: clean.slice(0, cuts[0]?.index), title: null, level: 0 });
	}
	cuts.forEach((cut, i) => {
		const raw = clean.slice(cut.index, cuts[i + 1]?.index);
		const end = raw.search(/<\/h[12]\s*>/i);
		const heading = htmlToPlainText(end < 0 ? raw : raw.slice(0, end))
			.replace(/\s+/g, " ")
			.trim();
		pieces.push({
			raw,
			title: heading.slice(0, MAX_TITLE_CHARS) || null,
			level: hasH1 && !cut.h1 ? 1 : 0,
		});
	});

	const chapters: HtmlChapter[] = [];
	for (const piece of pieces) {
		const html = sanitizeDocumentHtml(piece.raw);
		const text = htmlToPlainText(html);
		if (!text) continue;
		chapters.push({
			id: `s${chapters.length}`,
			title: piece.title ?? fallbackTitle,
			level: piece.level,
			html,
			text,
		});
	}
	return chapters;
}
