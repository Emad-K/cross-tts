import { useEffect } from "react";
import type { LoadedDocument } from "../types";
import { useListenEstimateStore } from "./listenEstimateStore";

/**
 * Mirrors the open book's chapter structure (EPUB spine + active chapter)
 * into the listen-estimate store, where the sleep timer's chapter targeting
 * reads it. Chapterless documents (TXT) sync an empty list.
 *
 * It also fetches the book's chapter text lengths for the "time left in book"
 * estimate. The measured synthesis rate is fed separately by the TTS engine
 * via recordSample.
 */
export function ListenEstimateSync({
	document,
	activeChapterId,
}: {
	document: LoadedDocument | null;
	activeChapterId: string | null;
}) {
	const setChapters = useListenEstimateStore((s) => s.setChapters);
	const setActiveChapter = useListenEstimateStore((s) => s.setActiveChapter);

	useEffect(() => {
		setChapters(document?.format === "epub" ? document.chapters : []);
	}, [document, setChapters]);

	// Chapter text lengths for the "time left in book" estimate.
	const filePath = document?.format === "epub" ? document.filePath : null;
	useEffect(() => {
		const { setChapterChars } = useListenEstimateStore.getState();
		setChapterChars(null);
		if (!filePath) return;
		let cancelled = false;
		void window.api?.request
			.getChapterTextLengths({ filePath })
			.then((lengths) => {
				if (!cancelled) setChapterChars(lengths);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [filePath]);

	useEffect(() => {
		setActiveChapter(activeChapterId);
	}, [activeChapterId, setActiveChapter]);

	return null;
}
