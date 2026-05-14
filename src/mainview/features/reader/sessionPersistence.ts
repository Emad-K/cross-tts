import type { WebPersistedSlice } from "@shared/appSession";
import {
	loadAppSession as loadAppSessionRpc,
	saveAppSession as saveAppSessionRpc,
} from "@/lib/electrobunRpc";
import { KOKORO_VOICE_IDS, type KokoroVoiceId } from "./tts/kokoroVoices";
import { useTtsStore } from "./tts/ttsStore";
import type { LoadedDocument } from "./types";

const DEBOUNCE_MS = 500;

/** Wired while session autosave is active; call when document changes. */
let scheduleSave: (() => void) | null = null;

export function touchSessionSave(): void {
	scheduleSave?.();
}

function coerceVoice(id: string): KokoroVoiceId {
	return KOKORO_VOICE_IDS.includes(id as KokoroVoiceId)
		? (id as KokoroVoiceId)
		: "af_heart";
}

function buildWebSlice(doc: LoadedDocument | null): WebPersistedSlice {
	const t = useTtsStore.getState();
	return {
		voice: t.voice,
		volumePct: t.volumePct,
		speed: t.speed,
		sourceText: doc?.text ?? t.sourceText,
		currentChunkIndex: t.currentChunkIndex,
		fileName: doc?.fileName ?? null,
	};
}

/**
 * Hydrate Zustand + return document to restore (if any).
 */
export async function loadPersistedReaderState(): Promise<{
	document: LoadedDocument | null;
	pendingChunkIndex: number | null;
}> {
	const file = await loadAppSessionRpc();
	if (!file?.web) {
		return { document: null, pendingChunkIndex: null };
	}
	const { web } = file;
	const voice = coerceVoice(web.voice);
	useTtsStore.getState().setVoice(voice);
	useTtsStore.getState().setVolumePct(web.volumePct);
	useTtsStore.getState().setSpeed(web.speed);

	const text = typeof web.sourceText === "string" ? web.sourceText : "";
	if (!text.trim()) {
		return { document: null, pendingChunkIndex: null };
	}

	const fileName =
		typeof web.fileName === "string" && web.fileName.length > 0
			? web.fileName
			: "Restored.txt";
	const chunk =
		typeof web.currentChunkIndex === "number" && web.currentChunkIndex >= 0
			? Math.floor(web.currentChunkIndex)
			: 0;

	return {
		document: { format: "txt", fileName, text },
		pendingChunkIndex: chunk,
	};
}

/**
 * Debounced save of reader + TTS prefs; merges current window frame on the Bun side.
 */
export function subscribeDebouncedSessionSave(
	getDocument: () => LoadedDocument | null,
): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const flush = () => {
		timer = null;
		void saveAppSessionRpc(buildWebSlice(getDocument()));
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
			void saveAppSessionRpc(buildWebSlice(getDocument()));
		}
	};

	const unsubStore = useTtsStore.subscribe(schedule);
	document.addEventListener("visibilitychange", onVisibility);
	scheduleSave = schedule;
	schedule();

	return () => {
		document.removeEventListener("visibilitychange", onVisibility);
		unsubStore();
		scheduleSave = null;
		if (timer !== null) clearTimeout(timer);
		void saveAppSessionRpc(buildWebSlice(getDocument()));
	};
}
