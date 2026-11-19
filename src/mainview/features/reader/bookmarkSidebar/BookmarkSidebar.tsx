import { BookmarkPlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { hasBookmark, sortBookmarks } from "@shared/bookmarks";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
	bookmarkCurrentSpot,
	navigateToBookmark,
	useBookmarksStore,
} from "../bookmarks/bookmarksStore";
import { NotesPanel } from "../notes/NotesPanel";
import { useNoteLocation, useNotesStore } from "../notes/notesStore";
import { useTtsStore } from "../tts";

export type BookmarkSidebarProps = {
	open: boolean;
	className?: string;
};

export function BookmarkSidebar({ open, className }: BookmarkSidebarProps) {
	const path = useBookmarksStore((s) => s.currentPath);
	const chapterId = useBookmarksStore((s) => s.currentChapterId);
	const byPath = useBookmarksStore((s) => s.byPath);
	const toggleAt = useBookmarksStore((s) => s.toggleAt);

	const chunks = useTtsStore((s) => s.chunks);
	const currentChunkIndex = useTtsStore((s) => s.currentChunkIndex);

	const list = path ? (byPath[path] ?? []) : [];
	const sorted = sortBookmarks(list);
	const canBookmark = path != null && chunks.length > 0;
	const alreadyHere =
		canBookmark && hasBookmark(list, chapterId, currentChunkIndex);

	const [tab, setTab] = useState<"bookmarks" | "notes">("bookmarks");
	const notePath = useNoteLocation().path;
	const noteCount = useNotesStore((s) =>
		notePath ? (s.byPath[notePath]?.length ?? 0) : 0,
	);
	const tabs = [
		{ id: "bookmarks", label: "Bookmarks", count: sorted.length },
		{ id: "notes", label: "Notes", count: noteCount },
	] as const;

	const addHere = () => {
		if (canBookmark) bookmarkCurrentSpot();
	};

	return (
		<aside
			aria-label="Bookmarks and notes"
			aria-hidden={!open}
			className={cn(
				"flex h-full min-h-0 w-full flex-col overflow-hidden bg-muted/20 transition-opacity duration-200 ease-out",
				open ? "opacity-100" : "pointer-events-none opacity-0",
				className,
			)}
		>
			{/* Clears the floating bookmarks toggle pinned at the page corner. */}
			<div className="h-11 shrink-0" aria-hidden />
			<div
				role="tablist"
				aria-label="Bookmarks and notes"
				className="flex shrink-0 gap-1 border-b border-border px-2 py-2"
			>
				{tabs.map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={tab === t.id}
						onClick={() => setTab(t.id)}
						className={cn(
							"flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
							tab === t.id
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
						)}
					>
						{t.label}
						{t.count > 0 ? (
							<span className="text-xs tabular-nums text-muted-foreground">
								{t.count}
							</span>
						) : null}
					</button>
				))}
			</div>

			{tab === "notes" ? (
				<NotesPanel />
			) : (
				<>
			<div className="shrink-0 px-3 py-3">
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="w-full gap-2 border-border bg-transparent"
					onClick={addHere}
					disabled={!canBookmark || alreadyHere}
					title={
						alreadyHere
							? "This spot is already bookmarked"
							: "Bookmark the current spot"
					}
				>
					<BookmarkPlus className="size-4" aria-hidden />
					{alreadyHere ? "Bookmarked" : "Add bookmark"}
				</Button>
			</div>

			<ScrollArea className="min-h-0 flex-1">
				{sorted.length === 0 ? (
					<div className="px-4 py-8 text-center">
						<p className="text-sm text-muted-foreground">No bookmarks yet.</p>
						<p className="mt-1 text-xs text-muted-foreground/80">
							Use “Add bookmark” to save your spot.
						</p>
					</div>
				) : (
					<ul className="space-y-0.5 px-2 pb-3">
						{sorted.map((b) => {
							const isCurrent =
								b.chapterId === chapterId && b.chunkIndex === currentChunkIndex;
							return (
								<li key={b.id}>
									<div
										className={cn(
											"group flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-accent",
											isCurrent && "bg-accent/60",
										)}
									>
										<button
											type="button"
											onClick={() => navigateToBookmark(b)}
											className="min-w-0 flex-1 px-2.5 py-2 text-left"
											title={b.label}
										>
											<span className="line-clamp-2 text-sm leading-snug text-foreground">
												{b.label}
											</span>
										</button>
										<button
											type="button"
											onClick={() => toggleAt(b)}
											aria-label="Delete bookmark"
											title="Delete bookmark"
											className="shrink-0 rounded p-1.5 text-muted-foreground/70 transition-colors hover:bg-destructive/15 hover:text-destructive"
										>
											<Trash2 className="size-4" aria-hidden />
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</ScrollArea>
				</>
			)}
		</aside>
	);
}
