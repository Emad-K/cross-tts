import { FolderOpen, PanelLeft, PanelLeftClose, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ReaderHeaderProps = {
	/** When omitted, the filename badge is hidden (no document yet). */
	fileName?: string | null;
	onOpenFile: () => void;
	onOpenSettings?: () => void;
	showChapterToggle?: boolean;
	chapterSidebarOpen?: boolean;
	onToggleChapterSidebar?: () => void;
	className?: string;
};

export function ReaderHeader({
	fileName,
	onOpenFile,
	onOpenSettings,
	showChapterToggle = false,
	chapterSidebarOpen = false,
	onToggleChapterSidebar,
	className,
}: ReaderHeaderProps) {
	return (
		<header
			className={cn(
				"shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
				className,
			)}
		>
			<div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-3.5">
				<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
					<span className="shrink-0 text-lg font-semibold tracking-tight text-foreground">
						reader
					</span>
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
					{showChapterToggle ? (
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="border-border bg-transparent text-foreground hover:bg-accent"
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
