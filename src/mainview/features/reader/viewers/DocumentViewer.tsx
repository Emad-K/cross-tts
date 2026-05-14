import type { LoadedDocument } from "../types";
import { TxtViewer } from "./TxtViewer";

type DocumentViewerProps = {
	document: LoadedDocument;
	/** Optional read-along / TTS highlight (phrase match). */
	highlightPhrase?: string;
};

/**
 * Routes the active {@link LoadedDocument} to the correct viewer.
 * Add new `case` branches when introducing EPUB, PDF, etc.
 */
export function DocumentViewer({
	document,
	highlightPhrase,
}: DocumentViewerProps) {
	switch (document.format) {
		case "txt":
			return (
				<TxtViewer
					text={document.text}
					highlightPhrase={highlightPhrase}
				/>
			);
		default: {
			const _never: never = document;
			return _never;
		}
	}
}
