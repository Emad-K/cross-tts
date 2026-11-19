import {
	MAX_NOTE_SNIPPET,
	type Note,
	type NoteColor,
	reanchor,
} from "@shared/notes";
import { normalizedReaderText, useTtsStore } from "../tts";
import { offsetAtClientPoint, selectionOffsets } from "./noteDom";
import { trimRange } from "./noteOffsets";
import { getNoteLocation, useNotesStore } from "./notesStore";

/** What a right click in the reader can act on. */
export type NoteTarget = {
	/** A highlight that could be made from the selection, not saved yet. */
	draft: Note | null;
	/** The saved highlight under the pointer, if any. */
	existing: Note | null;
};

/** Read the selection and pointer position at right-click time. */
export function captureNoteTarget(
	root: HTMLElement | null,
	x: number,
	y: number,
): NoteTarget {
	const { path, chapterId } = getNoteLocation();
	const { chunks, sourceText } = useTtsStore.getState();
	if (!root || !path || chunks.length === 0) return { draft: null, existing: null };
	const text = normalizedReaderText(sourceText);

	const sel = selectionOffsets(root, chunks);
	const range = sel && trimRange(text, sel.start, sel.end);
	const now = Date.now();
	const draft: Note | null = range && {
		id: crypto.randomUUID(),
		chapterId,
		...range,
		text: text.slice(range.start, range.end).slice(0, MAX_NOTE_SNIPPET),
		color: "yellow",
		createdAt: now,
		updatedAt: now,
	};

	const at = offsetAtClientPoint(root, chunks, x, y);
	const existing =
		at === null
			? null
			: ((useNotesStore.getState().byPath[path] ?? []).find((n) => {
					if (n.chapterId !== chapterId) return false;
					const r = reanchor(n, text);
					return r !== null && r.start <= at && at < r.end;
				}) ?? null);
	return { draft, existing };
}

/** Save a highlight made from the selection and clear the selection so it shows. */
export function saveHighlight(draft: Note, color: NoteColor): void {
	const { path } = getNoteLocation();
	if (!path) return;
	useNotesStore.getState().upsert(path, { ...draft, color });
	window.getSelection()?.removeAllRanges();
}
