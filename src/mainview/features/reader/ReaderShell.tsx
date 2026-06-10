import { Bookmark, BookMarked } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LoadedDocument } from "./types";
import { ListenEstimateSync } from "./listenEstimate/ListenEstimateSync";
import { SleepTimerEffect } from "./sleepTimer/SleepTimerEffect";
import { TtsRulesSettingSync } from "./ttsRules/TtsRulesSettingSync";
import { TtsSettingSync } from "./tts";
import { bookmarkCurrentSpot } from "./bookmarks/bookmarksStore";
import { ReaderDocumentLayout } from "./ReaderDocumentLayout";
import { FindBar } from "./find/FindBar";
import { useFindStore } from "./find/findStore";
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
	onOpenLibrary?: () => void;
	onOpenBook?: (path: string) => void;
	onOpenSettings?: () => void;
	onOpenLogs?: () => void;
	onOpenAudiobook?: () => void;
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
	onOpenLibrary,
	onOpenBook,
	onOpenSettings,
	onOpenLogs,
	onOpenAudiobook,
	onLoadSample,
	className,
}: ReaderShellProps) {
	const hasDoc = document !== null;
	const mightHaveChapters =
		document?.format === "epub" || Boolean(document?.chapters?.length);
	const [chapterSidebarOpen, setChapterSidebarOpen] = useState(false);
	const [bookmarkSidebarOpen, setBookmarkSidebarOpen] = useState(false);
	const findOpen = useFindStore((s) => s.open);
	const findInitialQuery = useFindStore((s) => s.initialQuery);
	const findRequestId = useFindStore((s) => s.requestId);

	useEffect(() => {
		const hasChapters =
			document?.format === "epub" ||
			Boolean(document?.chapters?.length);
		setChapterSidebarOpen(hasChapters);
		setBookmarkSidebarOpen(false);
		useFindStore.getState().closeFind();
	}, [document]);

	// Single-key reader shortcuts (ignored while typing): [ chapters, ] bookmarks,
	// b bookmark the current spot.
	useEffect(() => {
		if (!hasDoc) return;
		const onKey = (e: KeyboardEvent) => {
			// Ctrl/Cmd+F opens the in-chapter find bar (works while typing too).
			if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "f" || e.key === "F")) {
				useFindStore.getState().openFind();
				e.preventDefault();
				return;
			}
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const el = e.target as HTMLElement | null;
			const tag = el?.tagName;
			if (
				tag === "INPUT" ||
				tag === "TEXTAREA" ||
				tag === "SELECT" ||
				el?.isContentEditable
			) {
				return;
			}
			if (e.key === "[") {
				if (mightHaveChapters) {
					setChapterSidebarOpen((o) => !o);
					e.preventDefault();
				}
			} else if (e.key === "]") {
				setBookmarkSidebarOpen((o) => !o);
				e.preventDefault();
			} else if (e.key === "b" || e.key === "B") {
				bookmarkCurrentSpot();
				e.preventDefault();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [hasDoc, mightHaveChapters]);

	return (
		<TooltipProvider delayDuration={300} skipDelayDuration={0}>
			<TtsSettingSync />
			<TtsRulesSettingSync />
			<SleepTimerEffect />
			<ListenEstimateSync
				document={document}
				activeChapterId={activeChapterId}
			/>
			<div
				className={cn(
					"flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground",
					className,
				)}
			>
				<ReaderHeader
					fileName={hasDoc ? document.fileName : null}
					onOpenFile={onOpenFile}
					onOpenLibrary={onOpenLibrary}
					onOpenSettings={onOpenSettings}
					onOpenLogs={onOpenLogs}
					onOpenAudiobook={onOpenAudiobook}
					showAudiobook={document?.format === "epub"}
				/>
				<main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
					{documentLoading ? (
						<ReaderLoadingOverlay message={loadingMessage} />
					) : null}
					{hasDoc && findOpen ? (
						<FindBar
							key={findRequestId}
							initialQuery={findInitialQuery}
							onClose={() => useFindStore.getState().closeFind()}
						/>
					) : null}
					{hasDoc ? (
						<ReaderDocumentLayout
							document={document}
							chapterSidebarOpen={chapterSidebarOpen}
							bookmarkSidebarOpen={bookmarkSidebarOpen}
							activeChapterId={activeChapterId}
							initialChapterId={initialChapterId}
							onActiveChapterChange={onActiveChapterChange}
							className="min-h-0 flex-1"
						/>
					) : (
						<ReaderEmptyState
							onOpenFile={onOpenFile}
							onLoadSample={onLoadSample}
							onOpenBook={onOpenBook}
						/>
					)}

					{/* Floating sidebar toggles, at the page's two top corners. The
					    sidebars reserve top space so their content clears these. */}
					{hasDoc && mightHaveChapters ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className={cn(
								"absolute left-2 top-2 z-20 size-8 text-muted-foreground hover:bg-accent hover:text-foreground",
								chapterSidebarOpen && "text-foreground",
							)}
							onClick={() => setChapterSidebarOpen((o) => !o)}
							aria-pressed={chapterSidebarOpen}
							aria-label={chapterSidebarOpen ? "Hide chapters" : "Show chapters"}
							title={chapterSidebarOpen ? "Hide chapters" : "Show chapters"}
						>
							<BookMarked className="size-4" aria-hidden />
						</Button>
					) : null}
					{hasDoc ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className={cn(
								"absolute right-2 top-2 z-20 size-8 text-muted-foreground hover:bg-accent hover:text-foreground",
								bookmarkSidebarOpen && "text-foreground",
							)}
							onClick={() => setBookmarkSidebarOpen((o) => !o)}
							aria-pressed={bookmarkSidebarOpen}
							aria-label={
								bookmarkSidebarOpen ? "Hide bookmarks" : "Show bookmarks"
							}
							title={bookmarkSidebarOpen ? "Hide bookmarks" : "Show bookmarks"}
						>
							<Bookmark
								className={cn("size-4", bookmarkSidebarOpen && "fill-current")}
								aria-hidden
							/>
						</Button>
					) : null}
				</main>
				{hasDoc ? <PlaybackControls /> : null}
			</div>
		</TooltipProvider>
	);
}