import { BookMarked } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ReaderChapter } from "../types";

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
				"flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-border bg-muted/20 transition-[width,border-color,opacity] duration-200 ease-out",
				open
					? "w-[min(100%,17.5rem)] border-r opacity-100"
					: "pointer-events-none w-0 border-r-0 opacity-0",
				className,
			)}
		>
			<div
				className={cn(
					"flex h-full min-h-0 w-[min(100%,17.5rem)] flex-col",
					!open && "invisible",
				)}
			>
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
						<nav className="px-2 py-2" aria-label="Chapter list">
							<ul className="flex flex-col gap-0.5">
								{chapters.map((chapter) => {
									const active = chapter.id === activeChapterId;
									const level = chapter.level ?? 0;
									return (
										<li key={chapter.id}>
											<button
												type="button"
												onClick={() => onSelectChapter(chapter.id)}
												className={cn(
													"w-full rounded-md px-3 py-2 text-left text-sm leading-snug transition-colors",
													"hover:bg-accent/80 hover:text-accent-foreground",
													"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
													active &&
														"bg-accent text-accent-foreground shadow-sm",
													!active && "text-foreground/85",
												)}
												style={{
													paddingLeft: `${0.75 + level * 0.75}rem`,
												}}
												aria-current={active ? "location" : undefined}
												title={chapter.title}
											>
												<span className="line-clamp-2">{chapter.title}</span>
											</button>
										</li>
									);
								})}
							</ul>
						</nav>
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
			</div>
		</aside>
	);
}
