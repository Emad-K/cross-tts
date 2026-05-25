import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { ChapterSidebar } from "./chapterSidebar";
import { deriveTxtChapters } from "./lib/deriveTxtChapters";
import type { LoadedDocument, ReaderChapter } from "./types";
import { DocumentViewer } from "./viewers/DocumentViewer";

const CHAPTER_PANEL_ID = "chapters";
const DOCUMENT_PANEL_ID = "document";
const LAYOUT_STORAGE_ID = "cross-tts-chapter-sidebar";
const SIDEBAR_ANIMATION_MS = 200;

function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

export type ReaderDocumentLayoutProps = {
	document: LoadedDocument;
	chapterSidebarOpen: boolean;
	activeChapterId?: string | null;
	initialChapterId?: string | null;
	onActiveChapterChange?: (chapterId: string | null) => void;
	className?: string;
};

function chaptersForDocument(document: LoadedDocument): ReaderChapter[] {
	if (document.format === "epub") return document.chapters;
	if (document.chapters?.length) return document.chapters;
	if (document.format === "txt") {
		const derived = deriveTxtChapters(document.text);
		return derived.length > 1 ? derived : [];
	}
	return [];
}

/**
 * Reader body: optional chapter sidebar + scrollable document text.
 */
export function ReaderDocumentLayout({
	document,
	chapterSidebarOpen,
	activeChapterId: activeChapterIdProp,
	initialChapterId = null,
	onActiveChapterChange,
	className,
}: ReaderDocumentLayoutProps) {
	const chapters = useMemo(() => chaptersForDocument(document), [document]);
	const hasChapters = chapters.length > 0;
	const chapterPanelRef = usePanelRef();
	const expandedChapterSizeRef = useRef(20);
	const animationFrameRef = useRef<number | null>(null);
	const skipToggleAnimationRef = useRef(true);
	const isDraggingHandleRef = useRef(false);
	const { defaultLayout, onLayoutChanged: persistLayout } = useDefaultLayout({
		id: LAYOUT_STORAGE_ID,
		panelIds: hasChapters
			? [CHAPTER_PANEL_ID, DOCUMENT_PANEL_ID]
			: [DOCUMENT_PANEL_ID],
	});

	const cancelSidebarAnimation = useCallback(() => {
		if (animationFrameRef.current !== null) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}
	}, []);

	const animateChapterPanel = useCallback(
		(targetPercent: number) => {
			const panel = chapterPanelRef.current;
			if (!panel) return;

			if (isDraggingHandleRef.current) {
				panel.resize(`${targetPercent}%`);
				return;
			}

			cancelSidebarAnimation();
			const startPercent = panel.getSize().asPercentage;
			const startTime = performance.now();

			const step = (now: number) => {
				const progress = Math.min(1, (now - startTime) / SIDEBAR_ANIMATION_MS);
				const next =
					startPercent +
					(targetPercent - startPercent) * easeOutCubic(progress);
				panel.resize(`${next}%`);

				if (progress < 1) {
					animationFrameRef.current = requestAnimationFrame(step);
				} else {
					animationFrameRef.current = null;
				}
			};

			animationFrameRef.current = requestAnimationFrame(step);
		},
		[cancelSidebarAnimation, chapterPanelRef],
	);

	const handleLayoutChanged = useCallback(
		(layout: Record<string, number>) => {
			persistLayout(layout);
			const chapterSize = layout[CHAPTER_PANEL_ID];
			if (
				chapterSidebarOpen &&
				chapterSize > 0 &&
				animationFrameRef.current === null &&
				!isDraggingHandleRef.current
			) {
				expandedChapterSizeRef.current = chapterSize;
			}
		},
		[chapterSidebarOpen, persistLayout],
	);

	const isControlled = activeChapterIdProp !== undefined;
	const [internalChapterId, setInternalChapterId] = useState<string | null>(
		null,
	);
	const activeChapterId = isControlled
		? activeChapterIdProp
		: internalChapterId;

	useEffect(() => {
		const ids = new Set(chapters.map((c) => c.id));
		const preferred =
			initialChapterId && ids.has(initialChapterId)
				? initialChapterId
				: (chapters[0]?.id ?? null);

		if (isControlled) {
			if (activeChapterIdProp && ids.has(activeChapterIdProp)) return;
			if (preferred !== activeChapterIdProp) {
				onActiveChapterChange?.(preferred);
			}
			return;
		}

		setInternalChapterId(preferred);
	}, [
		document,
		chapters,
		initialChapterId,
		isControlled,
		activeChapterIdProp,
		onActiveChapterChange,
	]);

	useEffect(() => {
		if (isControlled) return;
		onActiveChapterChange?.(internalChapterId);
	}, [internalChapterId, isControlled, onActiveChapterChange]);

	useEffect(() => {
		if (!hasChapters) return;
		const panel = chapterPanelRef.current;
		if (!panel) return;

		if (skipToggleAnimationRef.current) {
			skipToggleAnimationRef.current = false;
			if (chapterSidebarOpen) {
				const size = panel.getSize().asPercentage;
				if (size > 0) expandedChapterSizeRef.current = size;
			} else if (!panel.isCollapsed()) {
				expandedChapterSizeRef.current = panel.getSize().asPercentage;
				panel.collapse();
			}
			return;
		}

		if (chapterSidebarOpen) {
			animateChapterPanel(expandedChapterSizeRef.current);
			return;
		}

		if (!panel.isCollapsed()) {
			expandedChapterSizeRef.current = panel.getSize().asPercentage;
		}
		animateChapterPanel(0);
	}, [
		chapterSidebarOpen,
		hasChapters,
		animateChapterPanel,
		chapterPanelRef,
	]);

	useEffect(() => () => cancelSidebarAnimation(), [cancelSidebarAnimation]);

	const selectChapter = (chapterId: string) => {
		if (!isControlled) setInternalChapterId(chapterId);
		onActiveChapterChange?.(chapterId);
	};

	return (
		<ResizablePanelGroup
			id={LAYOUT_STORAGE_ID}
			direction="horizontal"
			defaultLayout={defaultLayout}
			onLayoutChanged={handleLayoutChanged}
			className={cn("min-h-0 flex-1", className)}
		>
			{hasChapters ? (
				<>
					<ResizablePanel
						id={CHAPTER_PANEL_ID}
						panelRef={chapterPanelRef}
						defaultSize={20}
						minSize="160px"
						maxSize="480px"
						collapsible
						collapsedSize={0}
						className="min-w-0 overflow-hidden border-r border-border"
					>
						<ChapterSidebar
							open={chapterSidebarOpen}
							chapters={chapters}
							activeChapterId={activeChapterId}
							onSelectChapter={selectChapter}
						/>
					</ResizablePanel>
					<ResizableHandle
						onPointerDown={() => {
							isDraggingHandleRef.current = true;
							cancelSidebarAnimation();
						}}
						onPointerUp={() => {
							isDraggingHandleRef.current = false;
						}}
						onPointerCancel={() => {
							isDraggingHandleRef.current = false;
						}}
						className={cn(
							"transition-opacity duration-200 ease-out",
							!chapterSidebarOpen && "pointer-events-none opacity-0",
						)}
					/>
				</>
			) : null}
			<ResizablePanel
				id={DOCUMENT_PANEL_ID}
				minSize={30}
				defaultSize={hasChapters ? 80 : 100}
				className="min-w-0"
			>
				<div className="relative h-full min-h-0 min-w-0">
					<ScrollArea className="absolute inset-0 h-full min-h-0 w-full">
						<DocumentViewer
							document={document}
							activeChapterId={activeChapterId}
						/>
					</ScrollArea>
				</div>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
