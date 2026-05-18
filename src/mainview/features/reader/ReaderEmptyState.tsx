import { BookOpen, FileText, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ReaderEmptyStateProps = {
	onOpenFile: () => void;
	onLoadSample?: () => void;
	className?: string;
};

/**
 * Shown when no document is open. Library / recents can plug in here later.
 */
export function ReaderEmptyState({
	onOpenFile,
	onLoadSample,
	className,
}: ReaderEmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-1 flex-col items-center justify-center px-4 py-16 text-center",
				className,
			)}
		>
			<div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-border bg-muted/40 shadow-sm">
				<BookOpen className="size-8 text-muted-foreground" aria-hidden />
			</div>
			<h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
				Open a document
			</h1>
			<p className="mb-2 max-w-md text-sm text-muted-foreground sm:text-base">
				Open a plain text or EPUB book to read and listen with TTS.
			</p>
			<p className="mb-8 flex items-center justify-center gap-2 text-xs text-muted-foreground/90 sm:text-sm">
				<FileText className="size-4 shrink-0" aria-hidden />
				<span>.txt and .epub supported</span>
			</p>
			<div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">
				<Button
					type="button"
					size="lg"
					className="gap-2 sm:min-w-[11rem]"
					onClick={onOpenFile}
				>
					<FolderOpen className="size-4" aria-hidden />
					Open file
				</Button>
				{onLoadSample ? (
					<Button
						type="button"
						size="lg"
						variant="outline"
						className="border-border sm:min-w-[11rem]"
						onClick={onLoadSample}
					>
						Try sample
					</Button>
				) : null}
			</div>
		</div>
	);
}
