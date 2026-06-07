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
import { KOKORO_VOICE_IDS, type KokoroVoiceId } from "./tts/kokoroVoices";
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

const DEBOUNCE_MS = 500;

let scheduleSave: (() => void) | null = null;

export function touchSessionSave(): void {
	scheduleSave?.();
}

function coerceVoice(id: string): KokoroVoiceId {
	return KOKORO_VOICE_IDS.includes(id as KokoroVoiceId)
		? (id as KokoroVoiceId)
		: "af_heart";
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
			updatedAt: Date.now(),
		});
		useLibraryStore.getState().setBooks(books);
	}

	return {
		voice: t.voice,
		volumePct: t.volumePct,
		speed: t.speed,
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
	const voice = coerceVoice(web.voice);
	useTtsStore.getState().setVoice(voice);
	useTtsStore.getState().setVolumePct(web.volumePct);
	useTtsStore.getState().setSpeed(web.speed);
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

	const unsubStore = useTtsStore.subscribe(schedule);
	const unsubRules = useTtsRulesStore.subscribe(schedule);
	const unsubBookmarks = useBookmarksStore.subscribe(schedule);
	document.addEventListener("visibilitychange", onVisibility);
	scheduleSave = schedule;
	schedule();

	return () => {
		document.removeEventListener("visibilitychange", onVisibility);
		unsubStore();
		unsubRules();
		unsubBookmarks();
		scheduleSave = null;
		if (timer !== null) clearTimeout(timer);
		void saveAppSessionRpc(
			buildWebSlice(getDocument(), getActiveChapterId()),
		);
	};
}
