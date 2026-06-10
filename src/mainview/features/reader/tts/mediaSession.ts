import { useEffect, useRef } from "react";
import { getBookCover } from "@/lib/desktopBridge";
import { isExportActive } from "../audiobook/exportStore";
import type { LoadedDocument } from "../types";
import {
	pausePlayback,
	skipChunk,
	startOrResumePlayback,
} from "./ttsEngine";
import { useTtsStore, type PlaybackPhase } from "./ttsStore";

/**
 * OS media-controls integration (Windows SMTC / Linux MPRIS / macOS Now
 * Playing) via the renderer's `navigator.mediaSession`.
 *
 * Two Electron/Chromium caveats shape this module:
 *
 * 1. Chromium only surfaces a page's media session to the OS while an
 *    HTMLMediaElement is audibly playing — pure Web Audio (which this app
 *    uses for TTS playback) doesn't count (w3c/mediasession#48). So a silent
 *    looping <audio> "beacon" is played alongside TTS playback purely to
 *    activate the session.
 * 2. The app's global shortcuts (src/bun/globalShortcuts.ts) register
 *    Ctrl/Cmd+Shift+… accelerators, never hardware media keys, so the
 *    mediaSession action handlers here are the sole consumers of media keys —
 *    no double-trigger between globalShortcut and mediaSession.
 */

function hasMediaSession(): boolean {
	return (
		typeof navigator !== "undefined" &&
		"mediaSession" in navigator &&
		typeof MediaMetadata === "function"
	);
}

// --- Silent audio beacon -------------------------------------------------

/** Build a blob URL for ~10s of silent 8-bit mono WAV (Chromium ignores media
 * shorter than ~5s for media-session purposes). */
function silentWavUrl(): string {
	const rate = 8000;
	const samples = rate * 10;
	const buf = new ArrayBuffer(44 + samples);
	const v = new DataView(buf);
	const str = (off: number, s: string) => {
		for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
	};
	str(0, "RIFF");
	v.setUint32(4, 36 + samples, true);
	str(8, "WAVE");
	str(12, "fmt ");
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, 1, true); // mono
	v.setUint32(24, rate, true);
	v.setUint32(28, rate, true); // byte rate
	v.setUint16(32, 1, true); // block align
	v.setUint16(34, 8, true); // bits/sample
	str(36, "data");
	v.setUint32(40, samples, true);
	new Uint8Array(buf, 44).fill(0x80); // 8-bit PCM silence
	return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

let beacon: HTMLAudioElement | null = null;

function ensureBeacon(): HTMLAudioElement {
	if (!beacon) {
		const el = document.createElement("audio");
		el.src = silentWavUrl();
		el.loop = true;
		// Must be unmuted with volume > 0 or Chromium won't grant the session;
		// the samples themselves are silent, so this is inaudible.
		el.volume = 0.1;
		beacon = el;
	}
	return beacon;
}

// --- Metadata ------------------------------------------------------------

/** Last cover lookup, so chapter changes don't refetch the same book's cover. */
let coverCache: { path: string; src: string | null } | null = null;

async function coverArtwork(path: string): Promise<MediaImage[] | null> {
	if (coverCache?.path !== path) {
		coverCache = { path, src: await getBookCover(path).catch(() => null) };
	}
	return coverCache.src ? [{ src: coverCache.src }] : null;
}

function bookTitle(doc: LoadedDocument): string {
	return doc.format === "epub"
		? doc.title
		: doc.fileName.replace(/\.[^.]+$/, "");
}

// --- Playback state + actions ---------------------------------------------

function applyPlaybackPhase(phase: PlaybackPhase): void {
	const active =
		phase === "playing" || phase === "buffering" || phase === "loading_model";
	if (active) {
		navigator.mediaSession.playbackState = "playing";
		void ensureBeacon()
			.play()
			.catch(() => {});
	} else {
		navigator.mediaSession.playbackState =
			phase === "paused" ? "paused" : "none";
		beacon?.pause();
	}
}

type ChapterNavContext = {
	doc: LoadedDocument | null;
	activeChapterId: string | null;
	onChapterChange: (id: string) => void;
};

/** Jump to the prev/next chapter; false when there's no chapter to go to. */
function navigateChapter(ctx: ChapterNavContext, delta: 1 | -1): boolean {
	const { doc, activeChapterId } = ctx;
	if (doc?.format !== "epub" || !activeChapterId) return false;
	const idx = doc.chapters.findIndex((c) => c.id === activeChapterId);
	if (idx < 0) return false;
	const next = doc.chapters[idx + delta];
	if (!next) return false;
	ctx.onChapterChange(next.id);
	return true;
}

/**
 * Wires `navigator.mediaSession` to the TTS engine: book/chapter metadata,
 * playing/paused state, and play / pause / prev / next action handlers
 * (prev/next track = chapter for EPUBs, sentence otherwise; seek = sentence).
 *
 * Call once from ReaderApp.
 */
export function useMediaSession(
	doc: LoadedDocument | null,
	activeChapterId: string | null,
	onChapterChange: (id: string) => void,
): void {
	const ctxRef = useRef<ChapterNavContext>({
		doc,
		activeChapterId,
		onChapterChange,
	});
	ctxRef.current = { doc, activeChapterId, onChapterChange };

	// Playback state mirror + action handlers (registered once).
	useEffect(() => {
		if (!hasMediaSession()) return;
		const ms = navigator.mediaSession;

		applyPlaybackPhase(useTtsStore.getState().playback);
		const unsub = useTtsStore.subscribe((s, prev) => {
			if (s.playback !== prev.playback) applyPlaybackPhase(s.playback);
		});

		const setHandler = (
			action: MediaSessionAction,
			fn: MediaSessionActionHandler | null,
		) => {
			try {
				ms.setActionHandler(action, fn);
			} catch {
				// Action not supported on this platform — fine.
			}
		};
		// Ignore media keys while an audiobook export is running, matching the
		// OS-global shortcut handling in ReaderApp.
		const guarded =
			(fn: () => void): MediaSessionActionHandler =>
			() => {
				if (!isExportActive()) fn();
			};
		setHandler("play", guarded(() => void startOrResumePlayback()));
		setHandler("pause", guarded(() => void pausePlayback()));
		setHandler(
			"previoustrack",
			guarded(() => {
				if (!navigateChapter(ctxRef.current, -1)) skipChunk(-1);
			}),
		);
		setHandler(
			"nexttrack",
			guarded(() => {
				if (!navigateChapter(ctxRef.current, 1)) skipChunk(1);
			}),
		);
		setHandler("seekbackward", guarded(() => skipChunk(-1)));
		setHandler("seekforward", guarded(() => skipChunk(1)));

		return () => {
			unsub();
			for (const action of [
				"play",
				"pause",
				"previoustrack",
				"nexttrack",
				"seekbackward",
				"seekforward",
			] as MediaSessionAction[]) {
				setHandler(action, null);
			}
			ms.metadata = null;
			ms.playbackState = "none";
			beacon?.pause();
		};
	}, []);

	// Metadata: book title / chapter / cover art.
	useEffect(() => {
		if (!hasMediaSession()) return;
		const ms = navigator.mediaSession;
		if (!doc) {
			ms.metadata = null;
			return;
		}
		const base = {
			title: bookTitle(doc),
			artist: "Cross TTS",
			album: activeChapterId
				? (doc.chapters?.find((c) => c.id === activeChapterId)?.title ?? "")
				: "",
		};
		ms.metadata = new MediaMetadata(base);
		if (doc.format !== "epub") return;

		let cancelled = false;
		void coverArtwork(doc.filePath).then((artwork) => {
			if (cancelled || !artwork) return;
			ms.metadata = new MediaMetadata({ ...base, artwork });
		});
		return () => {
			cancelled = true;
		};
	}, [doc, activeChapterId]);
}
