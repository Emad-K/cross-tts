import {
	AudioLines,
	Bell,
	Clock,
	FolderOpen,
	PanelLeft,
	PanelLeftClose,
	Settings,
} from "lucide-react";
import type { BookProgress } from "@shared/recentBooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useLogStore } from "./logging";

export type ReaderHeaderProps = {
	/** When omitted, the filename badge is hidden (no document yet). */
	fileName?: string | null;
	onOpenFile: () => void;
	/** Recently-opened books, most-recent first. */
	recentBooks?: BookProgress[];
	/** Path of the currently-open book, to exclude from the recent menu. */
	currentPath?: string | null;
	onOpenRecent?: (path: string) => void;
	onOpenSettings?: () => void;
	onOpenLogs?: () => void;
	onOpenAudiobook?: () => void;
	showAudiobook?: boolean;
	showChapterToggle?: boolean;
	chapterSidebarOpen?: boolean;
	onToggleChapterSidebar?: () => void;
	className?: string;
};

/** Compact "x ago" label for the recent-books menu. */
function relativeTime(ms: number): string {
	const diff = Date.now() - ms;
	if (diff < 60_000) return "just now";
	const mins = Math.floor(diff / 60_000);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

export function ReaderHeader({
	fileName,
	onOpenFile,
	recentBooks = [],
	currentPath,
	onOpenRecent,
	onOpenSettings,
	onOpenLogs,
	onOpenAudiobook,
	showAudiobook = false,
	showChapterToggle = false,
	chapterSidebarOpen = false,
	onToggleChapterSidebar,
	className,
}: ReaderHeaderProps) {
	const unreadIssues = useLogStore((s) => s.unreadIssues);
	const otherBooks = recentBooks.filter((b) => b.path !== currentPath);
	const showRecent = Boolean(onOpenRecent) && otherBooks.length > 0;
	return (
		<header
			className={cn(
				"shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
				className,
			)}
		>
			<div className="mx-auto flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-3.5">
				<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
					{showChapterToggle ? (
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="shrink-0 border-border bg-transparent text-foreground hover:bg-accent"
							onClick={onToggleChapterSidebar}
							aria-label={
								chapterSidebarOpen ? "Hide chapters" : "Show chapters"
							}
							aria-pressed={chapterSidebarOpen}
							title={chapterSidebarOpen ? "Hide chapters" : "Show chapters"}
						>
							{chapterSidebarOpen ? (
								<PanelLeftClose className="size-4" aria-hidden />
							) : (
								<PanelLeft className="size-4" aria-hidden />
							)}
						</Button>
					) : null}
					{fileName ? (
						<Badge
							variant="secondary"
							className="w-fit max-w-full truncate rounded-md border border-border bg-muted px-2.5 py-0.5 font-normal text-foreground"
							title={fileName}
						>
							{fileName}
						</Badge>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
					{showRecent ? (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="gap-2 border-border bg-transparent text-foreground hover:bg-accent"
									title="Recently opened books"
								>
									<Clock className="size-4" aria-hidden />
									Recent
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="max-w-[20rem]">
								<DropdownMenuLabel>Recent books</DropdownMenuLabel>
								<DropdownMenuSeparator />
								{otherBooks.map((b) => (
									<DropdownMenuItem
										key={b.path}
										onSelect={() => onOpenRecent?.(b.path)}
										className="flex flex-col items-start gap-0.5"
									>
										<span className="w-full truncate font-medium" title={b.title}>
											{b.title}
										</span>
										<span className="text-xs text-muted-foreground">
											{relativeTime(b.updatedAt)}
										</span>
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="gap-2 border-border bg-transparent text-foreground hover:bg-accent"
						onClick={onOpenFile}
					>
						<FolderOpen className="size-4" aria-hidden />
						Open file
					</Button>
					{showAudiobook ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="gap-2 border-border bg-transparent text-foreground hover:bg-accent"
							onClick={onOpenAudiobook}
							title="Create audiobook"
						>
							<AudioLines className="size-4" aria-hidden />
							Audiobook
						</Button>
					) : null}
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="relative border-border bg-transparent text-foreground hover:bg-accent"
						onClick={onOpenLogs}
						aria-label={
							unreadIssues > 0
								? `Activity & logs (${unreadIssues} new)`
								: "Activity & logs"
						}
					>
						<Bell className="size-4" aria-hidden />
						{unreadIssues > 0 ? (
							<span
								className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
								aria-hidden
							>
								{unreadIssues > 9 ? "9+" : unreadIssues}
							</span>
						) : null}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="border-border bg-transparent text-foreground hover:bg-accent"
						onClick={onOpenSettings}
						aria-label="Settings"
					>
						<Settings className="size-4" aria-hidden />
					</Button>
				</div>
			</div>
		</header>
	);
}
