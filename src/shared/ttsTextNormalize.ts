/**
 * Light, audibly-safe text fixups applied to chunk text right before Kokoro
 * synthesis (after the user/builtin regex rules, never affecting on-screen
 * highlights). Keep transforms conservative — only changes that are unambiguous
 * improvements for the phonemizer belong here.
 */

/**
 * Separate a number glued to a following unit word so the phonemizer reads the
 * number and the word, not one mangled token. Common in cultivation novels:
 * `6000jin` → `6000 jin`, `100km` → `100 km`.
 *
 * Ordinals are preserved: `5th`, `21st`, `3rd`, `2nd` are left untouched so they
 * still read as "fifth", "twenty-first", etc. Single trailing letters (`3D`,
 * `3d`) are left alone too — splitting those usually hurts.
 */
export function splitNumberUnit(text: string): string {
	return text.replace(/(\d)(?!(?:st|nd|rd|th)\b)([A-Za-z]{2,})/g, "$1 $2");
}

/** All synthesis-time normalizations, in order. */
export function normalizeTtsSynthesisText(text: string): string {
	return splitNumberUnit(text);
}
