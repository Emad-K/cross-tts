import sanitizeHtml from "sanitize-html";
import {
	EPUB_SANITIZE_ALLOWED_ATTR,
	EPUB_SANITIZE_ALLOWED_TAGS,
} from "./epubHtmlPolicy";

const ALLOWED_TAGS = [...EPUB_SANITIZE_ALLOWED_TAGS];

/** Map global allowlist attrs onto each allowed tag (sanitize-html shape). */
const allowedAttributes = Object.fromEntries(
	ALLOWED_TAGS.map((tag) => [tag, [...EPUB_SANITIZE_ALLOWED_ATTR]]),
) as Record<string, string[]>;

const sanitizeOptions: sanitizeHtml.IOptions = {
	allowedTags: ALLOWED_TAGS,
	allowedAttributes,
	// EPUB chapters are body fragments; disallow document-level tags if present.
	disallowedTagsMode: "discard",
	allowVulnerableTags: false,
};

/**
 * Sanitize EPUB chapter HTML before parsing or rendering.
 * Uses `sanitize-html` (htmlparser2) — no jsdom, safe for Electrobun's Bun bundle.
 */
export function sanitizeEpubHtml(html: string): string {
	return sanitizeHtml(html, sanitizeOptions);
}
