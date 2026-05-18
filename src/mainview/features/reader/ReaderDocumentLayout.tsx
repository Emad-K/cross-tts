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
	className?: string;
};

function chaptersForDocument(document: LoadedDocument): ReaderChapter[] {
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
	className,
}: ReaderDocumentLayoutProps) {
	const chapters = useMemo(() => chaptersForDocument(document), [document]);
	const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

	useEffect(() => {
		setActiveChapterId(chapters[0]?.id ?? null);
	}, [document, chapters]);

	return (
		<div
			className={cn(
				"flex min-h-0 flex-1 overflow-hidden",
				className,
			)}
		>
			<ChapterSidebar
				open={chapterSidebarOpen}
				chapters={chapters}
				activeChapterId={activeChapterId}
				onSelectChapter={setActiveChapterId}
			/>
			<div className="relative min-h-0 min-w-0 flex-1">
				<ScrollArea className="absolute inset-0 h-full min-h-0 w-full">
					<DocumentViewer document={document} />
				</ScrollArea>
			</div>
		</div>
	);
}
