/** Highlight colours offered in the reader (CSS highlight names are `note-<color>`). */
export const NOTE_COLORS = ["yellow", "green", "pink"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** Longest stored copy of the highlighted text (used to find it again). */
export const MAX_NOTE_SNIPPET = 200;
/** Longest note a user can attach to a highlight. */
export const MAX_NOTE_BODY = 5000;

/** A highlighted passage, optionally with a written note. */
export type Note = {
	id: string;
	/** EPUB chapter id, or null for .txt. */
	chapterId: string | null;
	/** Character offsets into the chapter's plain text (the text TTS reads). */
	start: number;
	end: number;
	/** The first {@link MAX_NOTE_SNIPPET} highlighted characters. */
	text: string;
	color: NoteColor;
	note?: string;
	createdAt: number;
	updatedAt: number;
};

/** On-disk shape of `notes.json`: notes keyed by book path, like bookmarks. */
export type NotesFile = { version: 1; byPath: Record<string, Note[]> };

export function emptyNotesFile(): NotesFile {
	return { version: 1, byPath: {} };
}

function coerceNote(raw: unknown): Note | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	const { start, end } = o;
	if (typeof o.id !== "string" || !o.id) return null;
	if (typeof start !== "number" || typeof end !== "number") return null;
	if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
	if (start < 0 || end <= start) return null;
	if (typeof o.text !== "string" || !o.text) return null;
	const note =
		typeof o.note === "string" && o.note.trim()
			? o.note.slice(0, MAX_NOTE_BODY)
			: undefined;
	const createdAt = typeof o.createdAt === "number" ? o.createdAt : 0;
	return {
		id: o.id,
		chapterId:
			typeof o.chapterId === "string" && o.chapterId ? o.chapterId : null,
		start,
		end,
		text: o.text.slice(0, MAX_NOTE_SNIPPET),
		color: NOTE_COLORS.includes(o.color as NoteColor)
			? (o.color as NoteColor)
			: "yellow",
		...(note ? { note } : {}),
		createdAt,
		updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : createdAt,
	};
}

/** Validate a notes file read from disk (or a backup), dropping malformed entries. */
export function coerceNotesFile(raw: unknown): NotesFile {
	const out = emptyNotesFile();
	if (!raw || typeof raw !== "object") return out;
	const byPath = (raw as Record<string, unknown>).byPath;
	if (!byPath || typeof byPath !== "object") return out;
	for (const [path, value] of Object.entries(byPath as Record<string, unknown>)) {
		if (!path || !Array.isArray(value)) continue;
		const seen = new Set<string>();
		const list: Note[] = [];
		for (const item of value) {
			const note = coerceNote(item);
			if (note && !seen.has(note.id)) {
				seen.add(note.id);
				list.push(note);
			}
		}
		if (list.length > 0) out.byPath[path] = list;
	}
	return out;
}

/**
 * Where a note sits in the chapter text as it is now. The saved offsets win
 * when the saved snippet is still there; otherwise the closest occurrence of the
 * snippet is used (the book file was edited). Null means the passage is gone:
 * the note is still listed, just not painted.
 */
export function reanchor(
	note: Pick<Note, "start" | "end" | "text">,
	chapterText: string,
): { start: number; end: number } | null {
	if (!note.text) return null;
	const length = note.end - note.start;
	const at = (start: number) => ({
		start,
		end: Math.min(chapterText.length, start + length),
	});
	if (chapterText.startsWith(note.text, note.start)) return at(note.start);
	let best = -1;
	for (
		let i = chapterText.indexOf(note.text);
		i !== -1;
		i = chapterText.indexOf(note.text, i + 1)
	) {
		if (best === -1 || Math.abs(i - note.start) < Math.abs(best - note.start)) {
			best = i;
		}
	}
	return best === -1 ? null : at(best);
}

/** Notes in reading order within a chapter. */
export function sortNotes(list: Note[]): Note[] {
	return [...list].sort((a, b) => a.start - b.start || a.createdAt - b.createdAt);
}

const quote = (text: string) =>
	text
		.trim()
		.split(/\n+/)
		.map((line) => `> ${line.trim()}`)
		.join("\n");

/**
 * A book's highlights and notes as Markdown, grouped by chapter in book order.
 * `chapters` gives that order and the headings; a .txt book passes none.
 */
export function notesToMarkdown(
	bookTitle: string,
	notes: Note[],
	chapters: { id: string; title: string }[] = [],
): string {
	const order = new Map(chapters.map((c, i) => [c.id, i]));
	const rank = (n: Note) =>
		n.chapterId === null ? -1 : (order.get(n.chapterId) ?? chapters.length);
	const sorted = [...notes].sort(
		(a, b) => rank(a) - rank(b) || a.start - b.start || a.createdAt - b.createdAt,
	);
	const lines = [`# Notes: ${bookTitle}`, ""];
	let heading: string | null | undefined;
	for (const n of sorted) {
		if (n.chapterId !== heading) {
			heading = n.chapterId;
			const title =
				chapters.find((c) => c.id === n.chapterId)?.title ?? n.chapterId;
			if (title) lines.push(`## ${title}`, "");
		}
		const cut = n.end - n.start > n.text.length ? "…" : "";
		lines.push(quote(n.text + cut), "");
		if (n.note) lines.push(n.note.trim(), "");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}
