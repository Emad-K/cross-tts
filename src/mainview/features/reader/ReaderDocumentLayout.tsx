import { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ChapterSidebar } from "./chapterSidebar";
import { deriveTxtChapters } from "./lib/deriveTxtChapters";
import type { LoadedDocument, ReaderChapter } from "./types";
import { DocumentViewer } from "./viewers/DocumentViewer";

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

	const selectChapter = (chapterId: string) => {
		if (!isControlled) setInternalChapterId(chapterId);
		onActiveChapterChange?.(chapterId);
	};

	return (
		<div className={cn("flex min-h-0 flex-1 overflow-hidden", className)}>
			<ChapterSidebar
				open={chapterSidebarOpen}
				chapters={chapters}
				activeChapterId={activeChapterId}
				onSelectChapter={selectChapter}
			/>
			<div className="relative min-h-0 min-w-0 flex-1">
				<ScrollArea className="absolute inset-0 h-full min-h-0 w-full">
					<DocumentViewer
						document={document}
						activeChapterId={activeChapterId}
					/>
				</ScrollArea>
			</div>
		</div>
	);
}
