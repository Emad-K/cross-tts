import { useEffect, useState } from "react";
import type { LoadedDocument } from "./types";
import { SleepTimerEffect } from "./sleepTimer/SleepTimerEffect";
import { TtsRulesSettingSync } from "./ttsRules/TtsRulesSettingSync";
import { TtsSettingSync } from "./tts";
import { ReaderDocumentLayout } from "./ReaderDocumentLayout";
import { ReaderEmptyState } from "./ReaderEmptyState";
import { ReaderHeader } from "./ReaderHeader";
import { ReaderLoadingOverlay } from "./ReaderLoadingOverlay";
import { PlaybackControls } from "./PlaybackControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ReaderShellProps = {
	document: LoadedDocument | null;
	documentLoading?: boolean;
	loadingMessage?: string;
	activeChapterId?: string | null;
	initialChapterId?: string | null;
	onActiveChapterChange?: (chapterId: string | null) => void;
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
	documentLoading = false,
	loadingMessage = "Opening document…",
	activeChapterId = null,
	initialChapterId = null,
	onActiveChapterChange,
	onOpenFile,
	onOpenSettings,
	onLoadSample,
	className,
}: ReaderShellProps) {
	const hasDoc = document !== null;
	const [chapterSidebarOpen, setChapterSidebarOpen] = useState(false);

	useEffect(() => {
		const hasChapters =
			document?.format === "epub" ||
			Boolean(document?.chapters?.length);
		setChapterSidebarOpen(hasChapters);
	}, [document]);

	return (
		<TooltipProvider delayDuration={300} skipDelayDuration={0}>
			<TtsSettingSync />
			<TtsRulesSettingSync />
			<SleepTimerEffect />
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
					showChapterToggle={hasDoc}
					chapterSidebarOpen={chapterSidebarOpen}
					onToggleChapterSidebar={() =>
						setChapterSidebarOpen((open) => !open)
					}
				/>
				<main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
					{documentLoading ? (
						<ReaderLoadingOverlay message={loadingMessage} />
					) : null}
					{hasDoc ? (
						<ReaderDocumentLayout
							document={document}
							chapterSidebarOpen={chapterSidebarOpen}
							activeChapterId={activeChapterId}
							initialChapterId={initialChapterId}
							onActiveChapterChange={onActiveChapterChange}
							className="min-h-0 flex-1"
						/>
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