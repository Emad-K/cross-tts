import { Fragment, useMemo, type ReactNode } from "react";
import type { TtsChunk } from "@/features/reader/tts/chunkText";
import { normalizedReaderText } from "@/features/reader/tts/chunkText";
import { cn } from "@/lib/utils";

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
						"bg-amber-500/25 text-amber-400 [text-decoration:none]",
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
					role="button"
					tabIndex={0}
					className={cn(
						"cursor-pointer rounded-sm transition-colors",
						active &&
							"bg-amber-500/25 text-amber-400 ring-1 ring-amber-500/40",
						!active && "hover:bg-muted/40",
					)}
					onClick={() => onChunkClick?.(c.index)}
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
				"mx-auto w-full max-w-prose px-4 py-8 sm:px-8 sm:py-10 md:py-14",
				"font-serif text-[1.05rem] leading-[1.75] text-foreground/95 sm:text-lg sm:leading-8",
			)}
		>
			{chunkBody ? (
				<div className="whitespace-pre-wrap">{chunkBody}</div>
			) : (
				paragraphBody
			)}
		</div>
	);
}
