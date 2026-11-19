import type { WebPersistedSlice } from "@shared/appSession";
import type { ReadDocumentResult } from "@shared/documentRpc";
import { upsertRecentBook } from "@shared/recentBooks";
import {
	loadAppSession as loadAppSessionRpc,
	readDocumentAtPath,
	saveAppSession as saveAppSessionRpc,
} from "@/lib/desktopBridge";
import { useBookmarksStore } from "./bookmarks/bookmarksStore";
import { useLibraryStore } from "./library/libraryStore";
import { coerceEngineVoice, getTtsEngine } from "./tts/ttsEngines";
import { useTtsRulesStore } from "./ttsRules/ttsRulesStore";
import { useTtsStore } from "./tts/ttsStore";
import type { LoadedDocument } from "./types";

function documentTitle(doc: LoadedDocument): string {
	return doc.format === "epub" ? doc.title : doc.fileName;
}

/**
 * Approximate whole-book progress (0..1): for EPUBs, completed chapters plus the
 * fraction read of the current chapter; for plain text, fraction of chunks read.
 */
function readProgress(
	doc: LoadedDocument,
	chapterId: string | null,
	chunkIndex: number,
	chunkCount: number,
): number {
	const within = chunkCount > 0 ? Math.min(1, chunkIndex / chunkCount) : 0;
	if (doc.format === "epub") {
		const total = doc.chapters.length || 1;
		const idx = doc.chapters.findIndex((c) => c.id === chapterId);
		if (idx < 0) return 0;
		return Math.max(0, Math.min(1, (idx + within) / total));
	}
	return within;
}

const DEBOUNCE_MS = 2000;

let scheduleSave: (() => void) | null = null;
/** Set while buildWebSlice writes the library itself, so the save it is part of
 * doesn't schedule another save (which would loop forever). */
let writingLibraryFromSlice = false;

export function touchSessionSave(): void {
	scheduleSave?.();
}

export function buildWebSlice(
	doc: LoadedDocument | null,
	activeChapterId: string | null,
): WebPersistedSlice {
	const t = useTtsStore.getState();
	const rules = useTtsRulesStore.getState();
	const chapterId = doc?.format === "epub" ? activeChapterId : null;

	// Record the current book's position into the recent-books library so it can
	// be reopened and resumed later. Keyed by path; in-memory titles only.
	let books = useLibraryStore.getState().books;
	if (doc?.filePath) {
		books = upsertRecentBook(books, {
			path: doc.filePath,
			title: documentTitle(doc),
			format: doc.format,
			chapterId,
			chunkIndex: t.currentChunkIndex,
			progress: readProgress(doc, chapterId, t.currentChunkIndex, t.chunks.length),
			engine: t.engineId,
			voice: t.voice,
			speed: t.speed,
			updatedAt: Date.now(),
		});
		writingLibraryFromSlice = true;
		try {
			useLibraryStore.getState().setBooks(books);
		} finally {
			writingLibraryFromSlice = false;
		}
	}

	return {
		engine: t.engineId,
		voice: t.voice,
		volumePct: t.volumePct,
		speed: t.speed,
		sentencePauseMs: t.sentencePauseMs,
		supertonicSteps: t.supertonicSteps,
		licencesAccepted: t.licencesAccepted,
		documentPath: doc?.filePath ?? null,
		activeChapterId: chapterId,
		currentChunkIndex: t.currentChunkIndex,
		ttsTextRules: {
			regexRules: rules.regexRules,
			pronunciationRules: rules.pronunciationRules,
		},
		books,
		bookmarks: useBookmarksStore.getState().byPath,
	};
}

export function toLoadedDocument(result: ReadDocumentResult): LoadedDocument {
	if (result.format === "txt") {
		return {
			format: "txt",
			fileName: result.fileName,
			filePath: result.filePath,
			text: result.text,
		};
	}
	return {
		format: "epub",
		fileName: result.fileName,
		filePath: result.filePath,
		title: result.title,
		chapters: result.chapters,
	};
}

/**
 * Record a document at `path` in the recent-books library without opening it
 * (used by drag-and-drop). Existing entries keep their resume position and just
 * float to the top. Returns the book title, or null if the file was unreadable.
 */
export async function addBookToLibrary(path: string): Promise<string | null> {
	const existing = useLibraryStore.getState().books[path];
	if (existing) {
		const books = upsertRecentBook(useLibraryStore.getState().books, {
			...existing,
			updatedAt: Date.now(),
		});
		useLibraryStore.getState().setBooks(books);
		return existing.title;
	}
	// Title only: don't parse a PDF just to list it.
	const result = await readDocumentAtPath(path, { peek: true });
	if (!result) return null;
	const doc = toLoadedDocument(result);
	const title = documentTitle(doc);
	const books = upsertRecentBook(useLibraryStore.getState().books, {
		path,
		title,
		format: doc.format,
		chapterId: null,
		chunkIndex: 0,
		progress: 0,
		updatedAt: Date.now(),
	});
	useLibraryStore.getState().setBooks(books);
	return title;
}

export type HydratedSession = {
	documentPath: string | null;
	pendingChunkIndex: number | null;
	activeChapterId: string | null;
};

/** Restores TTS settings from disk without loading the document body. */
export async function hydratePersistedSession(): Promise<HydratedSession> {
	const file = await loadAppSessionRpc();
	if (!file?.web) {
		return {
			documentPath: null,
			pendingChunkIndex: null,
			activeChapterId: null,
		};
	}
	const { web } = file;
	// Before the engine: a restored engine may need its licence acknowledged.
	if (Array.isArray(web.licencesAccepted)) {
		useTtsStore.getState().setLicencesAccepted(web.licencesAccepted);
	}
	if (typeof web.supertonicSteps === "number") {
		useTtsStore.getState().setSupertonicSteps(web.supertonicSteps);
	}
	// Unknown or missing engine ids (sessions from before engines) → default.
	const engine = getTtsEngine(web.engine ?? "kokoro");
	useTtsStore.getState().setEngine(engine.id, coerceEngineVoice(engine, web.voice));
	useTtsStore.getState().setVolumePct(web.volumePct);
	useTtsStore.getState().setSpeed(web.speed);
	if (typeof web.sentencePauseMs === "number") {
		useTtsStore.getState().setSentencePauseMs(web.sentencePauseMs);
	}
	if (web.ttsTextRules) {
		useTtsRulesStore.getState().hydrate(web.ttsTextRules);
	}
	if (web.books) {
		useLibraryStore.getState().setBooks(web.books);
	}
	if (web.bookmarks) {
		useBookmarksStore.getState().setAll(web.bookmarks);
	}

	const documentPath =
		typeof web.documentPath === "string" && web.documentPath.length > 0
			? web.documentPath
			: null;

	const chunk =
		typeof web.currentChunkIndex === "number" && web.currentChunkIndex >= 0
			? Math.floor(web.currentChunkIndex)
			: 0;

	const savedChapterId =
		typeof web.activeChapterId === "string" && web.activeChapterId.length > 0
			? web.activeChapterId
			: null;

	return {
		documentPath,
		pendingChunkIndex: chunk,
		activeChapterId: savedChapterId,
	};
}

export async function loadDocumentFromPath(
	documentPath: string,
): Promise<LoadedDocument | null> {
	const loaded = await readDocumentAtPath(documentPath);
	if (!loaded) return null;
	return toLoadedDocument(loaded);
}

/** @deprecated Use hydratePersistedSession + loadDocumentFromPath */
export async function loadPersistedReaderState(): Promise<{
	document: LoadedDocument | null;
	pendingChunkIndex: number | null;
	activeChapterId: string | null;
}> {
	const session = await hydratePersistedSession();
	if (!session.documentPath) {
		return {
			document: null,
			pendingChunkIndex: session.pendingChunkIndex,
			activeChapterId: session.activeChapterId,
		};
	}
	const document = await loadDocumentFromPath(session.documentPath);
	return {
		document,
		pendingChunkIndex: session.pendingChunkIndex,
		activeChapterId: session.activeChapterId,
	};
}

export function subscribeDebouncedSessionSave(
	getDocument: () => LoadedDocument | null,
	getActiveChapterId: () => string | null,
): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const flush = () => {
		timer = null;
		void saveAppSessionRpc(
			buildWebSlice(getDocument(), getActiveChapterId()),
		);
	};

	const schedule = () => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(flush, DEBOUNCE_MS);
	};

	const onVisibility = () => {
		if (document.visibilityState === "hidden") {
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
			void saveAppSessionRpc(
				buildWebSlice(getDocument(), getActiveChapterId()),
			);
		}
	};

	// Window close / app quit may not fire visibilitychange, and the main process
	// does no final save of its own. invoke() posts the IPC message right away,
	// so a pending save still reaches main before the window is torn down.
	const onUnload = () => {
		if (timer === null) return;
		clearTimeout(timer);
		flush();
	};

	const unsubStore = useTtsStore.subscribe(schedule);
	const unsubRules = useTtsRulesStore.subscribe(schedule);
	const unsubBookmarks = useBookmarksStore.subscribe(schedule);
	const unsubLibrary = useLibraryStore.subscribe(() => {
		if (!writingLibraryFromSlice) schedule();
	});
	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("beforeunload", onUnload);
	window.addEventListener("pagehide", onUnload);
	scheduleSave = schedule;
	schedule();

	return () => {
		document.removeEventListener("visibilitychange", onVisibility);
		window.removeEventListener("beforeunload", onUnload);
		window.removeEventListener("pagehide", onUnload);
		unsubStore();
		unsubRules();
		unsubBookmarks();
		unsubLibrary();
		scheduleSave = null;
		if (timer !== null) clearTimeout(timer);
		void saveAppSessionRpc(
			buildWebSlice(getDocument(), getActiveChapterId()),
		);
	};
}
