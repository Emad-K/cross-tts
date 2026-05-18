import type { LoadedDocument } from "../types";
import { seekToChunkAndMaybePlay, useTtsStore } from "../tts";
import { EpubViewer } from "./EpubViewer";
import { TxtViewer } from "./TxtViewer";

type DocumentViewerProps = {
	document: LoadedDocument;
	activeChapterId: string | null;
};

/**
 * Routes the active {@link LoadedDocument} to the correct viewer.
 */
export function DocumentViewer({
	document,
	activeChapterId,
}: DocumentViewerProps) {
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
		case "epub":
			if (!activeChapterId) {
				return (
					<div className="flex min-h-[12rem] items-center justify-center px-8 py-16">
						<p className="text-sm text-muted-foreground">
							Select a chapter to begin reading.
						</p>
					</div>
				);
			}
			return (
				<EpubViewer
					filePath={document.filePath}
					chapterId={activeChapterId}
					chunks={chunks}
					activeChunkIndex={currentChunkIndex}
					highlightRange={highlightRange}
					onChunkClick={(i) => seekToChunkAndMaybePlay(i)}
				/>
			);
	}
}
