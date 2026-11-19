import { type RefObject, useEffect } from "react";
import { NOTE_COLORS, reanchor } from "@shared/notes";
import { normalizedReaderText, useTtsStore } from "../tts";
import { chunkElements, rangeForOffsets } from "./noteDom";
import { useNoteLocation, useNotesStore } from "./notesStore";
import "./notes.css";

const NOTED = "note-noted";
const HIGHLIGHT_NAMES = [...NOTE_COLORS.map((c) => `note-${c}`), NOTED];

/**
 * Paints the open chapter's highlights over the viewer inside `rootRef`.
 * Renders nothing: it only keeps the `note-*` CSS highlights up to date.
 */
export function NotesHighlighter({ rootRef }: { rootRef: RefObject<HTMLElement> }) {
	const { path, chapterId } = useNoteLocation();
	const notes = useNotesStore((s) => (path ? s.byPath[path] : undefined));
	const chunks = useTtsStore((s) => s.chunks);
	const sourceText = useTtsStore((s) => s.sourceText);

	useEffect(() => {
		const root = rootRef.current;
		if (!root || !("highlights" in CSS)) return;
		const mine = (notes ?? []).filter((n) => n.chapterId === chapterId);
		const text = normalizedReaderText(sourceText);

		const paint = () => {
			const els = chunkElements(root);
			const groups = new Map<string, Range[]>();
			const add = (name: string, range: Range) =>
				groups.set(name, [...(groups.get(name) ?? []), range]);
			for (const note of mine) {
				const at = reanchor(note, text);
				const range = at && rangeForOffsets(els, chunks, at.start, at.end);
				if (!range) continue;
				add(`note-${note.color}`, range);
				if (note.note) add(NOTED, range);
			}
			for (const name of HIGHLIGHT_NAMES) {
				const ranges = groups.get(name);
				if (!ranges) {
					CSS.highlights.delete(name);
					continue;
				}
				const highlight = new Highlight(...ranges);
				// Below the read-along word highlight, which uses the default 0.
				highlight.priority = -1;
				CSS.highlights.set(name, highlight);
			}
		};
		paint();

		// The chapter body renders after its text arrives, and React may swap
		// text nodes; repaint once per frame when the viewer's DOM changes.
		let frame = 0;
		const observer = new MutationObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(paint);
		});
		observer.observe(root, { childList: true, subtree: true, characterData: true });
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
			for (const name of HIGHLIGHT_NAMES) CSS.highlights.delete(name);
		};
	}, [rootRef, notes, chapterId, chunks, sourceText]);

	return null;
}
