import type { TtsChunk } from "../tts/chunkText";
import { chapterLength, locateOffset, shownOffset } from "./noteOffsets";

/**
 * Maps between the reader's DOM and chapter-text offsets. Both viewers tag each
 * read-along span with `data-chunk-index`; a chunk can be several spans (an
 * EPUB sentence crossing <em>), so offsets inside a chunk count text across all
 * of that chunk's spans, and go through `chapterLength` / `shownOffset` because
 * an EPUB page can show more spaces than the chapter text has. Nothing here
 * changes the DOM.
 */
const CHUNK = "[data-chunk-index]";

/** Every chunk's spans, in document order. */
export function chunkElements(root: HTMLElement): Map<number, HTMLElement[]> {
	const out = new Map<number, HTMLElement[]>();
	for (const el of root.querySelectorAll<HTMLElement>(CHUNK)) {
		const index = Number(el.dataset.chunkIndex);
		const list = out.get(index);
		if (list) list.push(el);
		else out.set(index, [el]);
	}
	return out;
}

/** Chapter-text offset of a DOM point (e.g. one end of the selection). */
export function offsetOfPoint(
	root: HTMLElement,
	chunks: TtsChunk[],
	node: Node,
	offset: number,
	bias: "start" | "end",
): number | null {
	const host = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
		CHUNK,
	);
	if (host && root.contains(host)) {
		const chunk = chunks[Number(host.dataset.chunkIndex)];
		if (!chunk) return null;
		let shown = "";
		for (const el of root.querySelectorAll<HTMLElement>(
			`[data-chunk-index="${chunk.index}"]`,
		)) {
			if (el === host) break;
			shown += el.textContent ?? "";
		}
		const upTo = document.createRange();
		upTo.selectNodeContents(host);
		upTo.setEnd(node, offset);
		return Math.min(
			chunk.end,
			chunk.start + chapterLength(shown + upTo.toString()),
		);
	}
	// Between chunks (paragraph gaps, images): snap to the neighbouring chunk.
	const point = document.createRange();
	point.setStart(node, offset);
	const els = [...root.querySelectorAll<HTMLElement>(CHUNK)];
	const after = (el: HTMLElement) => point.comparePoint(el, 0) >= 0;
	const el = bias === "start" ? els.find(after) : els.filter((e) => !after(e)).at(-1);
	const chunk = el ? chunks[Number(el.dataset.chunkIndex)] : undefined;
	if (!chunk) return null;
	return bias === "start" ? chunk.start : chunk.end;
}

/** Chapter-text offsets of the current selection, when it lies inside `root`. */
export function selectionOffsets(
	root: HTMLElement,
	chunks: TtsChunk[],
): { start: number; end: number } | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
	const range = sel.getRangeAt(0);
	if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
		return null;
	}
	const start = offsetOfPoint(root, chunks, range.startContainer, range.startOffset, "start");
	const end = offsetOfPoint(root, chunks, range.endContainer, range.endOffset, "end");
	return start !== null && end !== null && end > start ? { start, end } : null;
}

/** Chapter-text offset under a viewport point (e.g. a right click), if on text. */
export function offsetAtClientPoint(
	root: HTMLElement,
	chunks: TtsChunk[],
	x: number,
	y: number,
): number | null {
	const caret = document.caretRangeFromPoint(x, y);
	if (!caret || !root.contains(caret.startContainer)) return null;
	const el = caret.startContainer.parentElement?.closest(CHUNK);
	if (!el) return null;
	return offsetOfPoint(root, chunks, caret.startContainer, caret.startOffset, "start");
}

function domPoint(
	els: Map<number, HTMLElement[]>,
	chunks: TtsChunk[],
	offset: number,
	bias: "start" | "end",
): [Text, number] | null {
	const at = locateOffset(chunks, offset, bias);
	if (!at) return null;
	const nodes: Text[] = [];
	for (const el of els.get(at.index) ?? []) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
	}
	let left = shownOffset(nodes.map((n) => n.data).join(""), at.local, bias);
	for (const n of nodes) {
		if (left < n.length || (bias === "end" && left === n.length)) return [n, left];
		left -= n.length;
	}
	const last = nodes.at(-1);
	return last ? [last, last.length] : null;
}

/** A DOM Range covering chapter-text offsets `start..end`, or null if not rendered. */
export function rangeForOffsets(
	els: Map<number, HTMLElement[]>,
	chunks: TtsChunk[],
	start: number,
	end: number,
): Range | null {
	const from = domPoint(els, chunks, start, "start");
	const to = domPoint(els, chunks, end, "end");
	if (!from || !to) return null;
	const range = document.createRange();
	range.setStart(...from);
	range.setEnd(...to);
	return range.collapsed ? null : range;
}
