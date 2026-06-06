import { BookMarked } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ReaderChapter } from "../types";
import { VirtualChapterList } from "./VirtualChapterList";

export type ChapterSidebarProps = {
	open: boolean;
	chapters: ReaderChapter[];
	activeChapterId: string | null;
	onSelectChapter: (chapterId: string) => void;
	className?: string;
};

export function ChapterSidebar({
	open,
	chapters,
	activeChapterId,
	onSelectChapter,
	className,
}: ChapterSidebarProps) {
	const hasChapters = chapters.length > 0;

	return (
		<aside
			aria-label="Chapters"
			aria-hidden={!open}
			className={cn(
				"flex h-full min-h-0 w-full flex-col overflow-hidden bg-muted/20 transition-opacity duration-200 ease-out",
				open ? "opacity-100" : "pointer-events-none opacity-0",
				className,
			)}
		>
			{/* Clears the floating chapters toggle pinned at the page corner. */}
			<div className="h-11 shrink-0" aria-hidden />
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
				<BookMarked
					className="size-4 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<h2 className="text-sm font-semibold tracking-tight text-foreground">
					Chapters
				</h2>
				{hasChapters ? (
					<span className="ml-auto text-xs tabular-nums text-muted-foreground">
						{chapters.length}
					</span>
				) : null}
			</div>
			<ScrollArea className="min-h-0 flex-1">
				{hasChapters ? (
					<VirtualChapterList
						chapters={chapters}
						activeChapterId={activeChapterId}
						onSelectChapter={onSelectChapter}
					/>
				) : (
					<div className="px-4 py-8 text-center">
						<p className="text-sm text-muted-foreground">
							No chapters in this document yet.
						</p>
						<p className="mt-1 text-xs text-muted-foreground/80">
							Open an EPUB or a multi-section text file to see chapters.
						</p>
					</div>
				)}
			</ScrollArea>
		</aside>
	);
}
