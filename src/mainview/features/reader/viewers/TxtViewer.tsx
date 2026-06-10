import {
	Fragment,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	type ReactNode,
} from "react";
import type { TtsChunk } from "@/features/reader/tts/chunkText";
import { normalizedReaderText } from "@/features/reader/tts/chunkText";
import { SWEEP_CLASS, bindSweep } from "@/features/reader/tts/sweepStore";
import { cn } from "@/lib/utils";
import { isTextSelectionClick } from "./chunkClickGuard";

const SCROLL_EDGE_PADDING_PX = 12;

/** Prefer Radix reader viewport; fall back to any vertical scroll ancestor. */
function getScrollableViewport(el: HTMLElement): HTMLElement | null {
	const radix = el.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
	if (radix) return radix;
	let node: HTMLElement | null = el.parentElement;
	while (node) {
		const { overflowY } = getComputedStyle(node);
		if (
			(overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
			node.scrollHeight > node.clientHeight
		) {
			return node;
		}
		node = node.parentElement;
	}
	return null;
}

/**
 * Scroll the nearest scroll viewport so the element is fully visible (with padding).
 * If the element is taller than the viewport, align its top with padding below the
 * viewport top so read-along starts where speech begins.
 */
function scrollElementFullyVisible(el: HTMLElement, padding = SCROLL_EDGE_PADDING_PX) {
	const root = getScrollableViewport(el);
	if (!root) {
		el.scrollIntoView({ block: "nearest", inline: "nearest" });
		return;
	}
	const er = el.getBoundingClientRect();
	const rr = root.getBoundingClientRect();
	const elTop = root.scrollTop + (er.top - rr.top);
	const elBottom = elTop + er.height;
	const viewH = root.clientHeight;
	let top = root.scrollTop;

	if (elTop < top + padding) {
		top = elTop - padding;
	}
	if (elBottom > top + viewH - padding) {
		top = elBottom - viewH + padding;
	}
	if (elTop < top + padding) {
		top = elTop - padding;
	}

	const maxScroll = Math.max(0, root.scrollHeight - viewH);
	root.scrollTop = Math.min(maxScroll, Math.max(0, top));
}

export type TxtViewerProps = {
	text: string;
	/** Inclusive/exclusive indices into {@link normalizedReaderText}(text). */
	highlightRange?: { start: number; end: number } | null;
	chunks?: TtsChunk[];
	activeChunkIndex?: number | null;
	onChunkClick?: (index: number) => void;
};

function splitWithHighlight(
	text: string,
	range: { start: number; end: number } | null | undefined,
): { key: string; content: string; highlight: boolean }[] {
	if (!range || range.start >= range.end) {
		return [{ key: "0", content: text, highlight: false }];
	}
	const relStart = Math.max(0, range.start);
	const relEnd = Math.min(text.length, range.end);
	if (relStart >= relEnd) {
		return [{ key: "0", content: text, highlight: false }];
	}
	return [
		{ key: "a", content: text.slice(0, relStart), highlight: false },
		{ key: "b", content: text.slice(relStart, relEnd), highlight: true },
		{ key: "c", content: text.slice(relEnd), highlight: false },
	].filter((p) => p.content.length > 0);
}

function renderHighlightedSegments(
	segments: { key: string; content: string; highlight: boolean }[],
): ReactNode[] {
	return segments.map((seg) => (
		<Fragment key={seg.key}>
			{seg.highlight ? (
				<mark
					className={cn(
						"rounded-sm px-0.5",
						"bg-highlight text-highlight-foreground [text-decoration:none]",
					)}
				>
					{seg.content}
				</mark>
			) : (
				seg.content
			)}
		</Fragment>
	));
}

/**
 * Plain-text reader surface. With `chunks`, text is split into selectable read-along spans.
 */
export function TxtViewer({
	text,
	highlightRange,
	chunks,
	activeChunkIndex,
	onChunkClick,
}: TxtViewerProps) {
	const normalized = useMemo(() => normalizedReaderText(text), [text]);
	const activeChunkRef = useRef<HTMLSpanElement | null>(null);

	useLayoutEffect(() => {
		if (!chunks?.length || activeChunkIndex == null) return;
		const el = activeChunkRef.current;
		if (!el) return;
		scrollElementFullyVisible(el);
	}, [activeChunkIndex, chunks, normalized]);

	// Animate the in-sentence progress sweep on the active chunk element.
	useEffect(() => {
		const el = activeChunkRef.current;
		if (!el) return;
		return bindSweep(el);
	}, [activeChunkIndex, normalized]);

	const chunkBody = useMemo(() => {
		if (!chunks?.length) return null;
		const parts: ReactNode[] = [];
		let pos = 0;
		for (const c of chunks) {
			if (c.start > pos) {
				parts.push(
					<Fragment key={`gap-${pos}`}>{normalized.slice(pos, c.start)}</Fragment>,
				);
			}
			const active = activeChunkIndex === c.index;
			parts.push(
				<span
					key={`chunk-${c.index}`}
					ref={active ? activeChunkRef : undefined}
					role="button"
					tabIndex={0}
					className={cn(
						"cursor-pointer rounded-sm transition-colors",
						active &&
							"bg-highlight text-highlight-foreground ring-1 ring-highlight",
						active && SWEEP_CLASS,
						!active && "hover:bg-muted/40",
					)}
					onClick={() => {
						if (isTextSelectionClick(window.getSelection())) return;
						onChunkClick?.(c.index);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onChunkClick?.(c.index);
						}
					}}
				>
					{normalized.slice(c.start, c.end)}
				</span>,
			);
			pos = c.end;
		}
		if (pos < normalized.length) {
			parts.push(
				<Fragment key="tail">{normalized.slice(pos)}</Fragment>,
			);
		}
		return parts;
	}, [chunks, normalized, activeChunkIndex, onChunkClick]);

	const paragraphBody = useMemo(() => {
		const blocks: { block: string; start: number }[] = [];
		let from = 0;
		const rx = /\n\n+/g;
		let m: RegExpExecArray | null;
		while ((m = rx.exec(normalized))) {
			const block = normalized.slice(from, m.index);
			if (block.length > 0) blocks.push({ block, start: from });
			from = m.index + m[0].length;
		}
		const tail = normalized.slice(from);
		if (tail.length > 0) blocks.push({ block: tail, start: from });

		return blocks.map(({ block, start }, idx) => {
			const localRange = highlightRange
				? {
						start: highlightRange.start - start,
						end: highlightRange.end - start,
					}
				: null;
			return (
				<p key={`p-${idx}`} className="mb-6 last:mb-0">
					{renderHighlightedSegments(splitWithHighlight(block, localRange))}
				</p>
			);
		});
	}, [normalized, highlightRange]);

	return (
		<div
			className={cn(
				"reader-surface mx-auto w-full min-w-0 max-w-prose",
				"leading-[1.75] text-foreground/95 sm:leading-8",
			)}
		>
			{chunkBody ? (
				<div className="break-words whitespace-pre-wrap">{chunkBody}</div>
			) : (
				paragraphBody
			)}
		</div>
	);
}
