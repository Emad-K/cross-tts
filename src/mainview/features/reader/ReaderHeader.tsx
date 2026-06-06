import { AudioLines, Bell, Library, Plus, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLogStore } from "./logging";

export type ReaderHeaderProps = {
	/** When omitted, the filename badge is hidden (no document yet). */
	fileName?: string | null;
	/** Add (open) a book — shown on the home screen. */
	onOpenFile: () => void;
	/** Go to the Library (home). Present only while a document is open. */
	onOpenLibrary?: () => void;
	onOpenSettings?: () => void;
	onOpenLogs?: () => void;
	onOpenAudiobook?: () => void;
	showAudiobook?: boolean;
	className?: string;
};

export function ReaderHeader({
	fileName,
	onOpenFile,
	onOpenLibrary,
	onOpenSettings,
	onOpenLogs,
	onOpenAudiobook,
	showAudiobook = false,
	className,
}: ReaderHeaderProps) {
	const unreadIssues = useLogStore((s) => s.unreadIssues);
	const reading = Boolean(onOpenLibrary);
	return (
		<header
			className={cn(
				"shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
				className,
			)}
		>
			<div className="mx-auto flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-3.5">
				<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
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
					{reading ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="gap-2 border-border bg-transparent text-foreground hover:bg-accent"
							onClick={onOpenLibrary}
							title="Your library"
						>
							<Library className="size-4" aria-hidden />
							Library
						</Button>
					) : (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="gap-2 border-border bg-transparent text-foreground hover:bg-accent"
							onClick={onOpenFile}
							title="Add a book"
						>
							<Plus className="size-4" aria-hidden />
							Add
						</Button>
					)}
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
