import {
	EPUB_BLOCK_TAGS,
	isEpubSkipTag,
	isEpubVoidNoTextTag,
} from "./epubHtmlPolicy";
import { normalizeTextNodeContent } from "./htmlPlainText";

/** One DOM text node and its slice of the pre-canonical buffer (before trim/collapse). */
export type DomTextSpan = {
	node: Text;
	/** Normalized text shown in the webview for this node. */
	display: string;
	preStart: number;
	preEnd: number;
};

export type DomPlainTextPre = {
	pre: string;
	spans: DomTextSpan[];
};

/**
 * Walk the DOM and build the same pre-finalize string that {@link htmlToPlainText}
 * derives from HTML (tag → space, block close → \\n\\n, br → \\n, void tags omitted).
 */
export function buildDomPlainTextPre(root: Node): DomPlainTextPre {
	let pre = "";
	const spans: DomTextSpan[] = [];

	function walk(node: Node): void {
		if (node.nodeType === Node.TEXT_NODE) {
			const raw = node.textContent ?? "";
			if (!raw) return;
			const display = normalizeTextNodeContent(raw);
			const preStart = pre.length;
			pre += display;
			const preEnd = pre.length;
			spans.push({
				node: node as Text,
				display,
				preStart,
				preEnd,
			});
			return;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) return;

		const el = node as Element;
		const tag = el.tagName.toLowerCase();
		if (isEpubSkipTag(tag)) return;

		if (tag === "br") {
			pre += "\n";
			return;
		}

		if (isEpubVoidNoTextTag(tag)) return;

		// Block elements add a space on open and a paragraph break on close;
		// inline elements add nothing, so a tag glued inside a word (drop-caps,
		// styled letters) doesn't split it. Mirrors htmlToPlainText.
		const isBlock = EPUB_BLOCK_TAGS.has(tag);
		if (isBlock) pre += " ";

		for (const child of el.childNodes) {
			walk(child);
		}

		if (isBlock) pre += "\n\n";
	}

	for (const child of root.childNodes) {
		walk(child);
	}

	return { pre, spans };
}

/** Canonical [start, end) for a text node's pre slice. */
export function spanCanonicalRange(
	map: number[],
	span: DomTextSpan,
): { start: number; end: number } {
	return { start: map[span.preStart] ?? 0, end: map[span.preEnd] ?? 0 };
}

/** Map canonical indices to local offsets in {@link DomTextSpan.display}. */
export function canonicalRangeToDisplayOffsets(
	map: number[],
	span: DomTextSpan,
	canonStart: number,
	canonEnd: number,
): { ls: number; le: number } {
	const { preStart, preEnd, display } = span;
	const pLo = findPreAtOrAfter(map, preStart, preEnd, canonStart);
	const pHi = findPreAtOrAfter(map, preStart, preEnd, canonEnd);
	return {
		ls: Math.max(0, Math.min(display.length, pLo - preStart)),
		le: Math.max(0, Math.min(display.length, pHi - preStart)),
	};
}

function findPreAtOrAfter(
	map: number[],
	lo: number,
	hi: number,
	canon: number,
): number {
	let left = lo;
	let right = hi;
	while (left < right) {
		const mid = (left + right) >> 1;
		if ((map[mid] ?? 0) < canon) left = mid + 1;
		else right = mid;
	}
	return left;
}
