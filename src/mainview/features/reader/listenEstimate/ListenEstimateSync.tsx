import { useEffect } from "react";
import type { LoadedDocument } from "../types";
import { useListenEstimateStore } from "./listenEstimateStore";

/**
 * Mirrors the open book's chapter structure (EPUB spine + active chapter)
 * into the listen-estimate store, where the sleep timer's chapter targeting
 * reads it. Chapterless documents (TXT) sync an empty list.
 *
 * The measured synthesis rate that powers the chapter ETA is fed separately
 * by the TTS engine via recordSample.
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

	useEffect(() => {
		setActiveChapter(activeChapterId);
	}, [activeChapterId, setActiveChapter]);

	return null;
}
