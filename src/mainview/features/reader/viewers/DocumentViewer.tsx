import type { LoadedDocument } from "../types";
import { seekToChunkAndMaybePlay, useTtsStore } from "../tts";
import { TxtViewer } from "./TxtViewer";

type DocumentViewerProps = {
	document: LoadedDocument;
};

/**
 * Routes the active {@link LoadedDocument} to the correct viewer.
 * Add new `case` branches when introducing EPUB, PDF, etc.
 */
export function DocumentViewer({ document }: DocumentViewerProps) {
	const highlightRange = useTtsStore((s) => s.highlightRange);
	const chunks = useTtsStore((s) => s.chunks);
	const currentChunkIndex = useTtsStore((s) => s.currentChunkIndex);

	switch (document.format) {
		case "txt":
			return (
				<TxtViewer
					text={document.text}
					highlightRange={highlightRange}
					chunks={chunks}
					activeChunkIndex={currentChunkIndex}
					onChunkClick={(i) => seekToChunkAndMaybePlay(i)}
				/>
			);
	}
}
