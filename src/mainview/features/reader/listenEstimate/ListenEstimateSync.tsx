import { useEffect } from "react";
import { getEpubChapterContent } from "@/lib/desktopBridge";
import type { LoadedDocument } from "../types";
import { useListenEstimateStore } from "./listenEstimateStore";

/** Polite gap between background chapter-length fetches. */
const SWEEP_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Feeds the listen-time estimate with book structure: which chapters exist,
 * which is active, and (for EPUBs) how long each chapter's text is. Lengths
 * are fetched lazily one at a time in the background — the EPUB is already
 * parsed and cached in the main process, so each fetch is a cheap zip-entry
 * read — and cached per book path, enabling the "~Xh Ym in book" estimate.
 */
export function ListenEstimateSync({
	document,
	activeChapterId,
}: {
	document: LoadedDocument | null;
	activeChapterId: string | null;
}) {
	const setBook = useListenEstimateStore((s) => s.setBook);
	const setActiveChapter = useListenEstimateStore((s) => s.setActiveChapter);

	useEffect(() => {
		if (document?.format !== "epub") {
			setBook(document?.filePath ?? null, []);
			return;
		}
		setBook(
			document.filePath,
			document.chapters.map((c) => c.id),
		);
	}, [document, setBook]);

	useEffect(() => {
		setActiveChapter(activeChapterId);
	}, [activeChapterId, setActiveChapter]);

	useEffect(() => {
		if (document?.format !== "epub") return;
		const { filePath, chapters } = document;
		let cancelled = false;
		void (async () => {
			for (const ch of chapters) {
				if (cancelled) return;
				const store = useListenEstimateStore.getState();
				if (store.bookPath !== filePath) return;
				if (store.chapterChars[ch.id] !== undefined) continue;
				try {
					const content = await getEpubChapterContent(filePath, ch.id);
					if (cancelled) return;
					if (content) {
						useListenEstimateStore
							.getState()
							.setChapterChars(ch.id, content.text.length);
					}
				} catch {
					// Length stays unknown; the book estimate is simply skipped.
				}
				await delay(SWEEP_DELAY_MS);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [document]);

	return null;
}
