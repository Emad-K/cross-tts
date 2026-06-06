import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { BookmarkSidebar } from "./bookmarkSidebar/BookmarkSidebar";
import { ChapterSidebar } from "./chapterSidebar";
import { deriveTxtChapters } from "./lib/deriveTxtChapters";
import type { LoadedDocument, ReaderChapter } from "./types";
import { DocumentViewer } from "./viewers/DocumentViewer";

type PanelHandle = NonNullable<ReturnType<typeof usePanelRef>["current"]>;

const CHAPTER_PANEL_ID = "chapters";
const DOCUMENT_PANEL_ID = "document";
const BOOKMARK_PANEL_ID = "bookmarks";
const LAYOUT_STORAGE_ID = "cross-tts-chapter-sidebar";
const SIDEBAR_ANIMATION_MS = 200;

function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

export type ReaderDocumentLayoutProps = {
	document: LoadedDocument;
	chapterSidebarOpen: boolean;
	bookmarkSidebarOpen: boolean;
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
	bookmarkSidebarOpen,
	activeChapterId: activeChapterIdProp,
	initialChapterId = null,
	onActiveChapterChange,
	className,
}: ReaderDocumentLayoutProps) {
	const chapters = useMemo(() => chaptersForDocument(document), [document]);
	const hasChapters = chapters.length > 0;
	const chapterPanelRef = usePanelRef();
	const bookmarkPanelRef = usePanelRef();
	const expandedChapterSizeRef = useRef(20);
	const expandedBookmarkSizeRef = useRef(22);
	const chapterFrameRef = useRef<number | null>(null);
	const bookmarkFrameRef = useRef<number | null>(null);
	const skipChapterToggleRef = useRef(true);
	const skipBookmarkToggleRef = useRef(true);
	const isDraggingHandleRef = useRef(false);
	const { defaultLayout, onLayoutChanged: persistLayout } = useDefaultLayout({
		id: LAYOUT_STORAGE_ID,
		panelIds: [
			...(hasChapters ? [CHAPTER_PANEL_ID] : []),
			DOCUMENT_PANEL_ID,
			BOOKMARK_PANEL_ID,
		],
	});

	const cancelFrame = useCallback((ref: { current: number | null }) => {
		if (ref.current !== null) {
			cancelAnimationFrame(ref.current);
			ref.current = null;
		}
	}, []);

	const animatePanel = useCallback(
		(
			panel: PanelHandle | null,
			frameRef: { current: number | null },
			targetPercent: number,
		) => {
			if (!panel) return;
			if (isDraggingHandleRef.current) {
				panel.resize(`${targetPercent}%`);
				return;
			}
			cancelFrame(frameRef);
			const startPercent = panel.getSize().asPercentage;
			const startTime = performance.now();
			const step = (now: number) => {
				const progress = Math.min(1, (now - startTime) / SIDEBAR_ANIMATION_MS);
				const next =
					startPercent +
					(targetPercent - startPercent) * easeOutCubic(progress);
				panel.resize(`${next}%`);
				if (progress < 1) {
					frameRef.current = requestAnimationFrame(step);
				} else {
					frameRef.current = null;
				}
			};
			frameRef.current = requestAnimationFrame(step);
		},
		[cancelFrame],
	);

	const handleLayoutChanged = useCallback(
		(layout: Record<string, number>) => {
			persistLayout(layout);
			const chapterSize = layout[CHAPTER_PANEL_ID];
			if (
				chapterSidebarOpen &&
				chapterSize > 0 &&
				chapterFrameRef.current === null &&
				!isDraggingHandleRef.current
			) {
				expandedChapterSizeRef.current = chapterSize;
			}
			const bookmarkSize = layout[BOOKMARK_PANEL_ID];
			if (
				bookmarkSidebarOpen &&
				bookmarkSize > 0 &&
				bookmarkFrameRef.current === null &&
				!isDraggingHandleRef.current
			) {
				expandedBookmarkSizeRef.current = bookmarkSize;
			}
		},
		[chapterSidebarOpen, bookmarkSidebarOpen, persistLayout],
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

		if (skipChapterToggleRef.current) {
			skipChapterToggleRef.current = false;
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
			animatePanel(panel, chapterFrameRef, expandedChapterSizeRef.current);
			return;
		}
		if (!panel.isCollapsed()) {
			expandedChapterSizeRef.current = panel.getSize().asPercentage;
		}
		animatePanel(panel, chapterFrameRef, 0);
	}, [chapterSidebarOpen, hasChapters, animatePanel, chapterPanelRef]);

	useEffect(() => {
		const panel = bookmarkPanelRef.current;
		if (!panel) return;

		if (skipBookmarkToggleRef.current) {
			skipBookmarkToggleRef.current = false;
			if (bookmarkSidebarOpen) {
				const size = panel.getSize().asPercentage;
				if (size > 0) expandedBookmarkSizeRef.current = size;
			} else if (!panel.isCollapsed()) {
				expandedBookmarkSizeRef.current = panel.getSize().asPercentage;
				panel.collapse();
			}
			return;
		}

		if (bookmarkSidebarOpen) {
			animatePanel(panel, bookmarkFrameRef, expandedBookmarkSizeRef.current);
			return;
		}
		if (!panel.isCollapsed()) {
			expandedBookmarkSizeRef.current = panel.getSize().asPercentage;
		}
		animatePanel(panel, bookmarkFrameRef, 0);
	}, [bookmarkSidebarOpen, animatePanel, bookmarkPanelRef]);

	useEffect(
		() => () => {
			cancelFrame(chapterFrameRef);
			cancelFrame(bookmarkFrameRef);
		},
		[cancelFrame],
	);

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
							cancelFrame(chapterFrameRef);
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
			<ResizableHandle
				onPointerDown={() => {
					isDraggingHandleRef.current = true;
					cancelFrame(bookmarkFrameRef);
				}}
				onPointerUp={() => {
					isDraggingHandleRef.current = false;
				}}
				onPointerCancel={() => {
					isDraggingHandleRef.current = false;
				}}
				className={cn(
					"transition-opacity duration-200 ease-out",
					!bookmarkSidebarOpen && "pointer-events-none opacity-0",
				)}
			/>
			<ResizablePanel
				id={BOOKMARK_PANEL_ID}
				panelRef={bookmarkPanelRef}
				defaultSize={0}
				minSize="220px"
				maxSize="480px"
				collapsible
				collapsedSize={0}
				className="min-w-0 overflow-hidden border-l border-border"
			>
				<BookmarkSidebar open={bookmarkSidebarOpen} />
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
