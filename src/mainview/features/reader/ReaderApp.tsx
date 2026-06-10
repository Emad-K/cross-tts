import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
	type ChangeEvent,
} from "react";
import {
	getEpubChapterContent,
	getPendingCrashReports,
	isDesktopApp,
	pathForFile,
	pickDocument,
	subscribeToCrashReports,
	subscribeToMainProcessLogs,
	subscribeToShortcuts,
} from "@/lib/desktopBridge";
import type { CrashRecord } from "@shared/crashReport";
import { Toaster } from "@/components/toast/Toaster";
import { showToast } from "@/components/toast/toastStore";
import { partitionByDocumentSupport } from "@shared/droppedFiles";
import { SHORTCUT_VOLUME_STEP } from "@shared/shortcuts";
import { ReaderShell } from "./ReaderShell";
import { isExportActive } from "./audiobook/exportStore";
import { useLogStore } from "./logging";

const AudiobookExportDialog = lazy(() =>
	import("./audiobook/AudiobookExportDialog").then((m) => ({
		default: m.AudiobookExportDialog,
	})),
);
const SettingsDialog = lazy(() =>
	import("./settings/SettingsDialog").then((m) => ({
		default: m.SettingsDialog,
	})),
);
const LogPanel = lazy(() =>
	import("./logging").then((m) => ({ default: m.LogPanel })),
);
const CrashReportDialog = lazy(() => import("./crash/CrashReportDialog"));
import { useAppSettingsStore } from "./settings/appSettingsStore";
import { initUpdateStatusSync } from "./settings/updateStore";
import { useAppearanceSync } from "./settings/applyAppearance";
import { SAMPLE_TXT_DOCUMENT } from "./fixtures/sample-document";
import {
	addBookToLibrary,
	hydratePersistedSession,
	loadDocumentFromPath,
	subscribeDebouncedSessionSave,
	toLoadedDocument,
	touchSessionSave,
} from "./sessionPersistence";
import { getBookResume } from "./library/libraryStore";
import { initWatchedFoldersSync } from "./library/watchedFoldersSync";
import { KOKORO_VOICE_IDS, type KokoroVoiceId } from "./tts/kokoroVoices";
import {
	setBookmarkNavHandler,
	useBookmarksStore,
} from "./bookmarks/bookmarksStore";
import { useSleepTimerStore } from "./sleepTimer/sleepTimerStore";
import { shouldSleepAtChapterEnd } from "./sleepTimer/sleepTimerUtils";
import type { LoadedDocument } from "./types";
import {
	adjustVolume,
	seekToChunkAndMaybePlay,
	ensureKokoroLoaded,
	setChapterPlaybackFinishedHandler,
	skipChunk,
	startOrResumePlayback,
	stopPlaybackUi,
	toggleMute,
	togglePlayPause,
	useMediaSession,
	useTtsStore,
} from "./tts";

function documentKey(doc: LoadedDocument): string {
	return `${doc.format}:${doc.filePath ?? doc.fileName}`;
}

function readTxtFile(file: File): Promise<LoadedDocument> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const text =
				typeof reader.result === "string" ? reader.result : "";
			const path =
				"path" in file &&
				typeof (file as File & { path?: string }).path === "string"
					? (file as File & { path: string }).path
					: undefined;
			resolve({
				format: "txt",
				fileName: file.name,
				...(path ? { filePath: path } : {}),
				text,
			});
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsText(file);
	});
}

/** Minimal centered loading screen shown during the initial session restore. */
function BootScreen() {
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-5 bg-background">
			<span className="text-sm font-medium tracking-wide text-muted-foreground">
				Cross TTS
			</span>
			<div className="h-1 w-48 overflow-hidden rounded-full bg-muted">
				<div className="h-full w-1/3 rounded-full bg-primary [animation:boot_1.1s_ease-in-out_infinite]" />
			</div>
			<style>
				{
					"@keyframes boot{0%{transform:translateX(-120%)}100%{transform:translateX(360%)}}"
				}
			</style>
		</div>
	);
}

export function ReaderApp() {
	const inputRef = useRef<HTMLInputElement>(null);
	const [document, setDocument] = useState<LoadedDocument | null>(null);
	const [sessionReady, setSessionReady] = useState(false);
	// True until the initial session restore resolves, so the UI doesn't flash
	// the library before jumping to a restored book.
	const [booting, setBooting] = useState(true);
	const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
	const documentRef = useRef(document);
	const activeChapterIdRef = useRef(activeChapterId);
	documentRef.current = document;
	activeChapterIdRef.current = activeChapterId;

	const pendingChunkIndexRef = useRef<number | null>(null);
	/** Set when opening a recent book so its saved position survives the
	 * document-change reset (which otherwise starts a new document at chunk 0). */
	const forceResumeRef = useRef(false);
	const prevDocumentKeyRef = useRef<string | null>(null);
	const documentLoadContextRef = useRef({
		isDocumentChange: false,
		wasPlaying: false,
	});
	const prevEpubChapterIdRef = useRef<string | null>(null);
	const continuePlaybackAfterChapterRef = useRef(false);
	const [initialChapterId, setInitialChapterId] = useState<string | null>(null);
	const [documentLoading, setDocumentLoading] = useState(false);
	const [loadingMessage, setLoadingMessage] = useState("Opening document…");
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [logsOpen, setLogsOpen] = useState(false);
	const [audiobookOpen, setAudiobookOpen] = useState(false);
	/** Unreported crashes from previous runs; non-empty shows the crash dialog. */
	const [crashRecords, setCrashRecords] = useState<CrashRecord[]>([]);

	/** "Library" = close the current book and return to the My-books home grid. */
	const goToLibrary = useCallback(() => {
		stopPlaybackUi();
		pendingChunkIndexRef.current = null;
		setInitialChapterId(null);
		setActiveChapterId(null);
		setDocument(null);
	}, []);
	useAppearanceSync();
	// OS media controls (SMTC / MPRIS / Now Playing): metadata + media keys.
	useMediaSession(document, activeChapterId, setActiveChapterId);

	function isPlaybackActive(
		playback: ReturnType<typeof useTtsStore.getState>["playback"],
	): boolean {
		return (
			playback === "playing" ||
			playback === "buffering" ||
			playback === "loading_model"
		);
	}

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const session = await hydratePersistedSession();
			if (cancelled) return;
			setSessionReady(true);

			if (!session.documentPath) {
				setBooting(false);
				return;
			}

			pendingChunkIndexRef.current = session.pendingChunkIndex;
			setInitialChapterId(session.activeChapterId);
			if (session.activeChapterId) {
				setActiveChapterId(session.activeChapterId);
			}

			setLoadingMessage("Restoring your book…");
			setDocumentLoading(true);
			try {
				const doc = await loadDocumentFromPath(session.documentPath);
				if (cancelled || !doc) return;
				setDocument(doc);
			} finally {
				if (!cancelled) {
					setDocumentLoading(false);
					setBooting(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		void useAppSettingsStore.getState().hydrate();
	}, []);

	useEffect(() => {
		return subscribeToMainProcessLogs((entry) => {
			useLogStore.getState().add(entry);
		});
	}, []);

	// Mirror update state and toast a sticky "restart to update" when ready.
	useEffect(() => initUpdateStatusSync(), []);

	// Auto-add new books from watched folders. Waits for the session so the
	// initial scan dedupes against the hydrated library instead of an empty one.
	useEffect(() => {
		if (!sessionReady) return;
		return initWatchedFoldersSync();
	}, [sessionReady]);
	// Crashes recorded last run: subscribe first (push on launch), then pull a
	// snapshot in case the main process sent the event before we mounted.
	useEffect(() => {
		let cancelled = false;
		const unsubscribe = subscribeToCrashReports((records) => {
			if (records.length > 0) setCrashRecords(records);
		});
		void getPendingCrashReports().then((records) => {
			if (!cancelled && records.length > 0) setCrashRecords(records);
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	// Dispatch OS-global shortcut triggers (forwarded from the main process) to
	// the playback engine.
	useEffect(() => {
		return subscribeToShortcuts((action) => {
			// Ignore playback shortcuts while an audiobook export is running.
			if (isExportActive()) return;
			switch (action) {
				case "playPause":
					void togglePlayPause();
					break;
				case "nextChunk":
					skipChunk(1);
					break;
				case "prevChunk":
					skipChunk(-1);
					break;
				case "volumeUp":
					adjustVolume(SHORTCUT_VOLUME_STEP);
					break;
				case "volumeDown":
					adjustVolume(-SHORTCUT_VOLUME_STEP);
					break;
				case "mute":
					toggleMute();
					break;
			}
		});
	}, []);

	// Warm up the TTS model in the background once a document is open, so the
	// (one-time, ~17s on GPU) model load happens while the user reads instead of
	// on their first press of play. Waits for the GPU/CPU preference to hydrate
	// first so it loads the right weights. Idempotent; errors are already logged.
	useEffect(() => {
		if (!sessionReady || !document) return;
		let cancelled = false;
		void (async () => {
			await useAppSettingsStore.getState().hydrate();
			if (cancelled) return;
			await ensureKokoroLoaded().catch(() => {});
		})();
		return () => {
			cancelled = true;
		};
	}, [document, sessionReady]);

	useEffect(() => {
		setChapterPlaybackFinishedHandler(() => {
			const doc = documentRef.current;
			const chapterId = activeChapterIdRef.current;

			// End-of-chapter sleep timer: stop here instead of rolling into the
			// next chapter once the target chapter (or the current one, when no
			// target was picked) has finished.
			const sleep = useSleepTimerStore.getState();
			const sleepAtChapterEnd =
				sleep.mode === "endOfChapter" &&
				shouldSleepAtChapterEnd({
					targetChapterId: sleep.targetChapterId,
					chapterIds:
						doc?.format === "epub" ? doc.chapters.map((c) => c.id) : [],
					finishedChapterId: chapterId,
				});
			if (sleepAtChapterEnd) {
				sleep.clearTimer();
				showToast({ title: "Sleep timer — paused at end of chapter" });
			}

			if (!doc || doc.format !== "epub" || !chapterId) return false;

			const idx = doc.chapters.findIndex((c) => c.id === chapterId);
			if (idx < 0 || idx >= doc.chapters.length - 1) return false;

			if (sleepAtChapterEnd) {
				// Park at the start of the next chapter without resuming playback.
				stopPlaybackUi();
				setActiveChapterId(doc.chapters[idx + 1]!.id);
				return true;
			}

			continuePlaybackAfterChapterRef.current = true;
			setActiveChapterId(doc.chapters[idx + 1]!.id);
			return true;
		});
		return () => setChapterPlaybackFinishedHandler(null);
	}, []);

	useEffect(() => {
		if (!sessionReady) return;

		if (!document) {
			prevDocumentKeyRef.current = null;
			documentLoadContextRef.current = {
				isDocumentChange: false,
				wasPlaying: false,
			};
			stopPlaybackUi();
			useTtsStore.getState().setSourceText("");
			return;
		}

		const key = documentKey(document);
		const isDocumentChange =
			prevDocumentKeyRef.current !== null &&
			prevDocumentKeyRef.current !== key;
		const wasPlaying =
			isDocumentChange &&
			isPlaybackActive(useTtsStore.getState().playback);

		if (isDocumentChange) {
			// Keep the pending index when explicitly resuming a recent book.
			if (!forceResumeRef.current) pendingChunkIndexRef.current = null;
			if (wasPlaying) stopPlaybackUi();
		}

		documentLoadContextRef.current = { isDocumentChange, wasPlaying };
		prevDocumentKeyRef.current = key;
	}, [document, sessionReady]);

	useEffect(() => {
		if (!sessionReady || !document) return;
		if (document.format !== "txt") return;

		const { isDocumentChange, wasPlaying } =
			documentLoadContextRef.current;
		const force = forceResumeRef.current;
		forceResumeRef.current = false;
		const pending = pendingChunkIndexRef.current;
		pendingChunkIndexRef.current = null;
		const opts =
			(force || !isDocumentChange) && pending !== null && pending !== undefined
				? { chunkIndex: pending }
				: { chunkIndex: 0 };

		useTtsStore.getState().setSourceText(document.text, opts);

		if (isDocumentChange && wasPlaying) {
			void startOrResumePlayback();
		}
	}, [document, sessionReady]);

	useEffect(() => {
		prevEpubChapterIdRef.current = null;
	}, [document?.format === "epub" ? document.filePath : null]);

	useEffect(() => {
		if (!sessionReady || !document) return;
		if (document.format !== "epub" || !activeChapterId) {
			if (document?.format === "epub") {
				useTtsStore.getState().setSourceText("");
			}
			return;
		}

		const prevChapter = prevEpubChapterIdRef.current;
		const isChapterChange =
			prevChapter !== null && prevChapter !== activeChapterId;
		const autoContinue = continuePlaybackAfterChapterRef.current;
		if (autoContinue) continuePlaybackAfterChapterRef.current = false;
		const wasPlaying =
			autoContinue ||
			isPlaybackActive(useTtsStore.getState().playback);

		if (isChapterChange && wasPlaying) {
			stopPlaybackUi();
		}

		let cancelled = false;
		void (async () => {
			const content = await getEpubChapterContent(
				document.filePath,
				activeChapterId,
			);
			if (cancelled || !content) return;

			const { isDocumentChange, wasPlaying: wasPlayingDoc } =
				documentLoadContextRef.current;
			const force = forceResumeRef.current;
			forceResumeRef.current = false;
			const pending = pendingChunkIndexRef.current;
			pendingChunkIndexRef.current = null;
			const restoreChunk =
				(force || (!isDocumentChange && !isChapterChange)) &&
				pending !== null &&
				pending !== undefined;
			const opts = restoreChunk
				? { chunkIndex: pending }
				: { chunkIndex: 0 };

			useTtsStore.getState().setSourceText(content.text, opts);

			const resumePlayback =
				(isChapterChange && wasPlaying) ||
				(isDocumentChange && wasPlayingDoc);
			if (resumePlayback) {
				await startOrResumePlayback();
			}
		})();

		prevEpubChapterIdRef.current = activeChapterId;

		return () => {
			cancelled = true;
		};
	}, [document, activeChapterId, sessionReady]);

	useEffect(() => {
		if (!sessionReady) return;
		return subscribeDebouncedSessionSave(
			() => documentRef.current,
			() => activeChapterIdRef.current,
		);
	}, [sessionReady]);

	useEffect(() => {
		if (!sessionReady) return;
		touchSessionSave();
	}, [document, activeChapterId, sessionReady]);

	// Tell the bookmarks store where we are, so the toggle button knows what to
	// save and the jump handler can resolve cross-chapter bookmarks.
	useEffect(() => {
		useBookmarksStore
			.getState()
			.setLocation(document?.filePath ?? null, activeChapterId);
	}, [document, activeChapterId]);

	useEffect(() => {
		setBookmarkNavHandler((bm) => {
			if (bm.chapterId && bm.chapterId !== activeChapterIdRef.current) {
				forceResumeRef.current = true;
				pendingChunkIndexRef.current = bm.chunkIndex;
				setInitialChapterId(bm.chapterId);
				setActiveChapterId(bm.chapterId);
			} else {
				seekToChunkAndMaybePlay(bm.chunkIndex);
			}
		});
		return () => setBookmarkNavHandler(null);
	}, []);

	const openFilePicker = useCallback(() => {
		if (!isDesktopApp()) {
			inputRef.current?.click();
			return;
		}
		void (async () => {
			setLoadingMessage("Opening document…");
			setDocumentLoading(true);
			try {
				const picked = await pickDocument();
				if (picked) {
					pendingChunkIndexRef.current = null;
					setInitialChapterId(null);
					setActiveChapterId(
						picked.format === "epub"
							? (picked.chapters[0]?.id ?? null)
							: null,
					);
					setDocument(toLoadedDocument(picked));
				}
			} catch {
				inputRef.current?.click();
			} finally {
				setDocumentLoading(false);
			}
		})();
	}, []);

	const openRecentBook = useCallback((path: string) => {
		if (!isDesktopApp()) return;
		void (async () => {
			const resume = getBookResume(path);
			setLoadingMessage("Opening book…");
			setDocumentLoading(true);
			try {
				const doc = await loadDocumentFromPath(path);
				if (!doc) return;
				// Restore this book's own voice / speed (falls back to current).
				if (
					resume?.voice &&
					KOKORO_VOICE_IDS.includes(resume.voice as KokoroVoiceId)
				) {
					useTtsStore.getState().setVoice(resume.voice as KokoroVoiceId);
				}
				if (resume?.speed != null) {
					useTtsStore.getState().setSpeed(resume.speed);
				}
				forceResumeRef.current = resume?.chunkIndex != null;
				pendingChunkIndexRef.current = resume?.chunkIndex ?? null;
				setInitialChapterId(resume?.chapterId ?? null);
				setActiveChapterId(
					doc.format === "epub"
						? (resume?.chapterId ?? doc.chapters[0]?.id ?? null)
						: null,
				);
				setDocument(doc);
			} finally {
				setDocumentLoading(false);
			}
		})();
	}, []);

	const onFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		const lower = file.name.toLowerCase();
		if (!lower.endsWith(".txt") && !lower.endsWith(".epub")) return;
		if (lower.endsWith(".epub")) return;
		try {
			pendingChunkIndexRef.current = null;
			setInitialChapterId(null);
			setActiveChapterId(null);
			setDocument(await readTxtFile(file));
		} catch {
			// Engine / toast layer can surface errors later.
		}
	}, []);

	const [dragActive, setDragActive] = useState(false);

	const handleDroppedFiles = useCallback(
		async (files: File[]) => {
			const { supported, rejected } = partitionByDocumentSupport(files);
			if (rejected.length > 0) {
				showToast({
					title:
						rejected.length === 1
							? `"${rejected[0]?.name}" isn't supported`
							: `${rejected.length} files skipped`,
					description: "Only .txt and .epub files can be added.",
					variant: "destructive",
				});
			}
			if (supported.length === 0) return;

			if (!isDesktopApp()) {
				// Web build can't read paths: open the first dropped .txt directly.
				const txt = supported.find((f) =>
					f.name.toLowerCase().endsWith(".txt"),
				);
				if (!txt) {
					showToast({
						title: "EPUBs need the desktop app",
						variant: "destructive",
					});
					return;
				}
				try {
					pendingChunkIndexRef.current = null;
					setInitialChapterId(null);
					setActiveChapterId(null);
					setDocument(await readTxtFile(txt));
				} catch {
					showToast({
						title: `Couldn't read "${txt.name}"`,
						variant: "destructive",
					});
				}
				return;
			}

			// One file opens right away (the session save records it in the library);
			// several files are added to the library to read later.
			if (supported.length === 1) {
				const file = supported[0];
				const path = file ? pathForFile(file) : null;
				if (path) openRecentBook(path);
				return;
			}

			let added = 0;
			for (const file of supported) {
				const path = pathForFile(file);
				if (path && (await addBookToLibrary(path)) !== null) added++;
			}
			touchSessionSave();
			if (added > 0) {
				showToast({
					title: `Added ${added} book${added === 1 ? "" : "s"} to your library`,
				});
			}
			if (added < supported.length) {
				const failed = supported.length - added;
				showToast({
					title: `Couldn't add ${failed} file${failed === 1 ? "" : "s"}`,
					description: "They may be unreadable or invalid documents.",
					variant: "destructive",
				});
			}
		},
		[openRecentBook],
	);

	// Whole-window drag-and-drop: every view accepts .txt/.epub drops.
	useEffect(() => {
		let depth = 0;
		const hasFiles = (e: DragEvent) =>
			Array.from(e.dataTransfer?.types ?? []).includes("Files");
		const onDragEnter = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			depth++;
			setDragActive(true);
		};
		const onDragOver = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
		};
		const onDragLeave = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) setDragActive(false);
		};
		const onDrop = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			depth = 0;
			setDragActive(false);
			const files = Array.from(e.dataTransfer?.files ?? []);
			if (files.length > 0) void handleDroppedFiles(files);
		};
		window.addEventListener("dragenter", onDragEnter);
		window.addEventListener("dragover", onDragOver);
		window.addEventListener("dragleave", onDragLeave);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragenter", onDragEnter);
			window.removeEventListener("dragover", onDragOver);
			window.removeEventListener("dragleave", onDragLeave);
			window.removeEventListener("drop", onDrop);
		};
	}, [handleDroppedFiles]);

	if (booting) return <BootScreen />;

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
			<input
				ref={inputRef}
				type="file"
				accept=".txt,.epub,text/plain,application/epub+zip"
				className="sr-only"
				aria-hidden
				tabIndex={-1}
				onChange={onFileChange}
			/>
			<ReaderShell
				className="min-h-0 flex-1"
				document={document}
				documentLoading={documentLoading}
				loadingMessage={loadingMessage}
				activeChapterId={activeChapterId}
				initialChapterId={initialChapterId}
				onActiveChapterChange={setActiveChapterId}
				onOpenFile={openFilePicker}
				onOpenLibrary={document ? goToLibrary : undefined}
				onOpenBook={openRecentBook}
				onOpenSettings={() => setSettingsOpen(true)}
				onOpenLogs={() => setLogsOpen(true)}
				onOpenAudiobook={() => setAudiobookOpen(true)}
				onLoadSample={() => {
					pendingChunkIndexRef.current = null;
					setInitialChapterId(null);
					setActiveChapterId(null);
					setDocument(SAMPLE_TXT_DOCUMENT);
				}}
			/>
			{/* Heavy, on-demand dialogs are code-split: their chunks (and deps like
			    the MP3 encoder) load on first open, not at startup. */}
			{settingsOpen ? (
				<Suspense fallback={null}>
					<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
				</Suspense>
			) : null}
			{logsOpen ? (
				<Suspense fallback={null}>
					<LogPanel open={logsOpen} onOpenChange={setLogsOpen} />
				</Suspense>
			) : null}
			{document?.format === "epub" && audiobookOpen ? (
				<Suspense fallback={null}>
					<AudiobookExportDialog
						open={audiobookOpen}
						onOpenChange={setAudiobookOpen}
						filePath={document.filePath}
						bookTitle={document.title}
						chapters={document.chapters}
					/>
				</Suspense>
			) : null}
			{crashRecords.length > 0 ? (
				<Suspense fallback={null}>
					<CrashReportDialog
						records={crashRecords}
						onClose={() => setCrashRecords([])}
					/>
				</Suspense>
			) : null}
			{dragActive ? (
				<div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
					<div className="rounded-xl border-2 border-dashed border-primary px-10 py-8 text-center">
						<p className="text-lg font-medium">Drop books to add them</p>
						<p className="mt-1 text-sm text-muted-foreground">
							.epub and .txt files
						</p>
					</div>
				</div>
			) : null}
			<Toaster />
		</div>
	);
}
