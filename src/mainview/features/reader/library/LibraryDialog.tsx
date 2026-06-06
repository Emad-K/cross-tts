import { BookOpen, Clock } from "lucide-react";
import type { BookProgress } from "@shared/recentBooks";
import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

function relativeTime(ms: number): string {
	if (!ms) return "";
	const diff = Date.now() - ms;
	if (diff < 60_000) return "just now";
	const mins = Math.floor(diff / 60_000);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

export type LibraryDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** All books, most-recent first. */
	books: BookProgress[];
	currentPath: string | null;
	onOpenBook: (path: string) => void;
};

export function LibraryDialog({
	open,
	onOpenChange,
	books,
	currentPath,
	onOpenBook,
}: LibraryDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Library</DialogTitle>
					<DialogDescription>
						Books you've opened. Select one to continue where you left off.
					</DialogDescription>
				</DialogHeader>

				{books.length === 0 ? (
					<p className="py-8 text-center text-sm text-muted-foreground">
						No books yet. Open a file to start your library.
					</p>
				) : (
					<ScrollArea className="max-h-[60vh]">
						<ul className="space-y-1 pr-2">
							{books.map((b) => {
								const isCurrent = b.path === currentPath;
								return (
									<li key={b.path}>
										<button
											type="button"
											disabled={isCurrent}
											onClick={() => {
												if (isCurrent) return;
												onOpenBook(b.path);
												onOpenChange(false);
											}}
											className={cn(
												"flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors",
												isCurrent
													? "cursor-default bg-muted/40"
													: "hover:border-border hover:bg-accent",
											)}
										>
											<BookOpen
												className="size-5 shrink-0 text-muted-foreground"
												aria-hidden
											/>
											<span className="min-w-0 flex-1">
												<span
													className="block truncate font-medium"
													title={b.title}
												>
													{b.title}
												</span>
												<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
													<Clock className="size-3" aria-hidden />
													{relativeTime(b.updatedAt) || "—"}
													<span className="uppercase">· {b.format}</span>
												</span>
											</span>
											{isCurrent ? (
												<Badge variant="secondary" className="shrink-0">
													Reading
												</Badge>
											) : null}
										</button>
									</li>
								);
							})}
						</ul>
					</ScrollArea>
				)}
			</DialogContent>
		</Dialog>
	);
}
