import type { LoadedDocument } from "./types";
import { DocumentViewer } from "./viewers/DocumentViewer";
import { ReaderEmptyState } from "./ReaderEmptyState";
import { ReaderHeader } from "./ReaderHeader";
import { PlaybackControls } from "./PlaybackControls";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ReaderShellProps = {
	document: LoadedDocument | null;
	highlightPhrase?: string;
	onOpenFile: () => void;
	onOpenSettings?: () => void;
	onLoadSample?: () => void;
	className?: string;
};

/**
 * Full-window reader chrome: top bar, scrollable body, optional playback bar.
 */
export function ReaderShell({
	document,
	highlightPhrase,
	onOpenFile,
	onOpenSettings,
	onLoadSample,
	className,
}: ReaderShellProps) {
	const hasDoc = document !== null;

	return (
		<TooltipProvider delayDuration={300} skipDelayDuration={0}>
			<div
				className={cn(
					"dark flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground",
					className,
				)}
			>
				<ReaderHeader
					fileName={hasDoc ? document.fileName : null}
					onOpenFile={onOpenFile}
					onOpenSettings={onOpenSettings}
				/>
				<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
					{hasDoc ? (
						<div className="relative min-h-0 flex-1">
							<ScrollArea className="absolute inset-0 h-full min-h-0 w-full">
								<DocumentViewer
									document={document}
									highlightPhrase={highlightPhrase}
								/>
							</ScrollArea>
						</div>
					) : (
						<ReaderEmptyState
							onOpenFile={onOpenFile}
							onLoadSample={onLoadSample}
						/>
					)}
				</main>
				{hasDoc ? <PlaybackControls /> : null}
			</div>
		</TooltipProvider>
	);
}