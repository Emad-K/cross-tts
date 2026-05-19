import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ChangeEvent,
} from "react";
import {
	getEpubChapterContent,
	isElectrobunWebview,
	pickDocument,
} from "@/lib/electrobunRpc";
import { ReaderShell } from "./ReaderShell";
import { TtsRulesSettingsDialog } from "./ttsRules/TtsRulesSettingsDialog";
import { SAMPLE_TXT_DOCUMENT } from "./fixtures/sample-document";
import {
	hydratePersistedSession,
	loadDocumentFromPath,
	subscribeDebouncedSessionSave,
	toLoadedDocument,
	touchSessionSave,
} from "./sessionPersistence";
import type { LoadedDocument } from "./types";
import {
	setChapterPlaybackFinishedHandler,
	startOrResumePlayback,
	stopPlaybackUi,
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

export function ReaderApp() {
	const inputRef = useRef<HTMLInputElement>(null);
	const [document, setDocument] = useState<LoadedDocument | null>(null);
	const [sessionReady, setSessionReady] = useState(false);
	const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
	const documentRef = useRef(document);
	const activeChapterIdRef = useRef(activeChapterId);
	documentRef.current = document;
	activeChapterIdRef.current = activeChapterId;

	const pendingChunkIndexRef = useRef<number | null>(null);
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

			if (!session.documentPath) return;

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
				if (!cancelled) setDocumentLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		setChapterPlaybackFinishedHandler(() => {
			const doc = documentRef.current;
			const chapterId = activeChapterIdRef.current;
			if (!doc || doc.format !== "epub" || !chapterId) return false;

			const idx = doc.chapters.findIndex((c) => c.id === chapterId);
			if (idx < 0 || idx >= doc.chapters.length - 1) return false;

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
			pendingChunkIndexRef.current = null;
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
		const pending = pendingChunkIndexRef.current;
		pendingChunkIndexRef.current = null;
		const opts =
			!isDocumentChange && pending !== null && pending !== undefined
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
			const pending = pendingChunkIndexRef.current;
			pendingChunkIndexRef.current = null;
			const restoreChunk =
				!isDocumentChange &&
				!isChapterChange &&
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

	const openFilePicker = useCallback(() => {
		if (!isElectrobunWebview()) {
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
				onOpenSettings={() => setSettingsOpen(true)}
				onLoadSample={() => {
					pendingChunkIndexRef.current = null;
					setInitialChapterId(null);
					setActiveChapterId(null);
					setDocument(SAMPLE_TXT_DOCUMENT);
				}}
			/>
			<TtsRulesSettingsDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
			/>
		</div>
	);
}
