import { Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getEpubChapterContent } from "@/lib/desktopBridge";
import type { TtsChunk } from "@/features/reader/tts/chunkText";
import { cn } from "@/lib/utils";
import { bindSweep } from "@/features/reader/tts/sweepStore";
import {
	parseEpubReadAlong,
	plainTextFromHtmlDom,
	renderEpubReadAlong,
} from "./epubHtmlRender";
import { scrollElementFullyVisible } from "./scrollActiveChunk";

export type EpubViewerProps = {
	filePath: string;
	chapterId: string;
	chunks: TtsChunk[];
	activeChunkIndex: number | null;
	highlightRange: { start: number; end: number } | null;
	onChunkClick?: (index: number) => void;
};

export function EpubViewer({
	filePath,
	chapterId,
	chunks,
	activeChunkIndex,
	highlightRange,
	onChunkClick,
}: EpubViewerProps) {
	const [html, setHtml] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const activeChunkRef = useRef<HTMLSpanElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		setHtml(null);
		void (async () => {
			try {
				const content = await getEpubChapterContent(filePath, chapterId);
				if (cancelled) return;
				if (!content?.html) {
					setError("Could not load this chapter.");
					return;
				}
				setHtml(content.html);
			} catch {
				if (!cancelled) setError("Could not load this chapter.");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [filePath, chapterId]);

	useLayoutEffect(() => {
		if (!chunks.length || activeChunkIndex == null) return;
		const el = activeChunkRef.current;
		if (!el) return;
		scrollElementFullyVisible(el);
	}, [activeChunkIndex, chunks, html]);

	// Animate the in-sentence progress sweep on the active chunk element. Rebinds
	// when the active chunk (or the rendered chapter) changes.
	useEffect(() => {
		const el = activeChunkRef.current;
		if (!el) return;
		return bindSweep(el);
	}, [activeChunkIndex, html]);

	// DOM parse + offset map depend only on the chapter HTML; memoize them so
	// they don't rerun on every chunk advance (the O(n²) map was the hot path).
	const parsed = useMemo(() => (html ? parseEpubReadAlong(html) : null), [html]);

	const body = useMemo(() => {
		if (!parsed) return null;
		return renderEpubReadAlong(parsed, {
			chunks,
			activeChunkIndex,
			highlightRange,
			onChunkClick,
			activeChunkRef: (el) => {
				activeChunkRef.current = el;
			},
		});
	}, [parsed, chunks, activeChunkIndex, highlightRange, onChunkClick]);

	useEffect(() => {
		if (!html || !chunks.length) return;
		const domPlain = plainTextFromHtmlDom(html);
		const chunkEnd = chunks[chunks.length - 1]?.end ?? 0;
		if (domPlain.length !== chunkEnd) {
			console.warn(
				"EPUB highlight offset drift: extracted length",
				domPlain.length,
				"TTS length",
				chunkEnd,
			);
		}
	}, [html, chunks]);

	if (loading) {
		return (
			<div
				className="flex min-h-[12rem] flex-col items-center justify-center gap-3 px-8 py-16"
				role="status"
				aria-live="polite"
				aria-busy="true"
			>
				<Loader2
					className="size-7 animate-spin text-muted-foreground"
					aria-hidden
				/>
				<p className="text-sm text-muted-foreground">Loading chapter…</p>
			</div>
		);
	}

	if (error || !html || !body) {
		return (
			<div className="flex min-h-[12rem] items-center justify-center px-8 py-16">
				<p className="text-sm text-destructive">{error ?? "Chapter unavailable."}</p>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"reader-surface epub-chapter mx-auto w-full min-w-0 max-w-prose",
				"leading-[1.75] text-foreground/95 sm:leading-8",
				"[&_img]:max-w-full [&_img]:h-auto",
				"[&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline",
				"[&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold",
				"[&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold",
				"[&_p]:mb-4",
			)}
		>
			{body}
		</div>
	);
}
