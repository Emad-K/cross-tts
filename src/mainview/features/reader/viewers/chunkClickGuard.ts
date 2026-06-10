/** The subset of {@link Selection} the click guard needs (testable without DOM). */
export type SelectionLike = Pick<Selection, "isCollapsed" | "toString"> | null;

/**
 * True when the pointer-up that produced a click was really a text-selection
 * drag, so the chunk click-to-play should be ignored. A plain click collapses
 * the selection on mousedown, so `isCollapsed` distinguishes the two; the
 * `toString()` check skips degenerate non-collapsed selections with no text.
 */
export function isTextSelectionClick(selection: SelectionLike): boolean {
	if (!selection) return false;
	if (selection.isCollapsed) return false;
	return selection.toString().length > 0;
}
