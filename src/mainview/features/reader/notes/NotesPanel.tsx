import { Download, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { type Note, notesToMarkdown, reanchor, sortNotes } from "@shared/notes";
import { showToast } from "@/components/toast/toastStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getEpubChapterContent } from "@/lib/desktopBridge";
import { cn } from "@/lib/utils";
import { useOpenBookStore } from "../bookData/openBookStore";
import { navigateToBookmark } from "../bookmarks/bookmarksStore";
import { getMaxChunkChars } from "../settings/appSettingsStore";
import { buildTtsChunks, normalizedReaderText, useTtsStore } from "../tts";
import { chunkIndexAtOffset } from "../tts/chunkText";
import { NoteDialog } from "./NoteDialog";
import { getNoteLocation, useNoteLocation, useNotesStore } from "./notesStore";
import "./notes.css";

/** Go to a note's passage, opening its chapter first when it is in another one. */
async function jumpToNote(path: string, note: Note): Promise<void> {
	let text = normalizedReaderText(useTtsStore.getState().sourceText);
	let chunks = useTtsStore.getState().chunks;
	if (note.chapterId !== getNoteLocation().chapterId) {
		// Chunked exactly as the reader will chunk it, so the index matches.
		const content = note.chapterId
			? await getEpubChapterContent(path, note.chapterId).catch(() => null)
			: null;
		if (!content) {
			showToast({ title: "Couldn't open that chapter", variant: "destructive" });
			return;
		}
		text = normalizedReaderText(content.text);
		chunks = buildTtsChunks(text, getMaxChunkChars());
	}
	const start = reanchor(note, text)?.start ?? note.start;
	navigateToBookmark({
		id: note.id,
		chapterId: note.chapterId,
		chunkIndex: chunkIndexAtOffset(chunks, start),
		label: note.text,
		createdAt: note.createdAt,
	});
}

async function exportNotes(title: string, markdown: string): Promise<void> {
	const fileName = `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "book"} - notes.md`;
	if (!window.api) {
		// Browser preview: no save dialog, so download instead.
		const a = document.createElement("a");
		a.href = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
		a.download = fileName;
		a.click();
		URL.revokeObjectURL(a.href);
		return;
	}
	try {
		const result = await window.api.request.exportTextFile({
			text: markdown,
			suggestedFileName: fileName,
		});
		if (result.filePath) {
			showToast({ title: "Notes exported", description: result.filePath });
		}
	} catch (err) {
		showToast({
			title: "Couldn't export notes",
			description: err instanceof Error ? err.message : String(err),
			variant: "destructive",
		});
	}
}

/** The Notes tab of the bookmarks sidebar: this book's highlights and notes. */
export function NotesPanel() {
	const book = useOpenBookStore((s) => s.book);
	const { path, chapterId } = useNoteLocation();
	const list = useNotesStore((s) => (path ? s.byPath[path] : undefined)) ?? [];
	const remove = useNotesStore((s) => s.remove);
	const [editing, setEditing] = useState<Note | null>(null);

	if (!book || !path) {
		return (
			<p className="px-4 py-8 text-center text-sm text-muted-foreground">
				Open a saved book to highlight and take notes.
			</p>
		);
	}

	// Book order: chapter by chapter, then position in the chapter.
	const chapterRank = new Map(book.chapters.map((c, i) => [c.id, i]));
	const rank = (n: Note) =>
		n.chapterId ? (chapterRank.get(n.chapterId) ?? book.chapters.length) : -1;
	const sorted = sortNotes(list).sort((a, b) => rank(a) - rank(b));
	const chapterTitle = (id: string | null) =>
		id ? (book.chapters.find((c) => c.id === id)?.title ?? id) : null;

	return (
		<>
			<div className="shrink-0 px-3 py-3">
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="w-full gap-2 border-border bg-transparent"
					disabled={sorted.length === 0}
					onClick={() =>
						void exportNotes(
							book.title,
							notesToMarkdown(book.title, list, book.chapters),
						)
					}
				>
					<Download className="size-4" aria-hidden />
					Export as Markdown
				</Button>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				{sorted.length === 0 ? (
					<div className="px-4 py-8 text-center">
						<p className="text-sm text-muted-foreground">No highlights yet.</p>
						<p className="mt-1 text-xs text-muted-foreground/80">
							Select text in the book, then right-click and choose Highlight
							or Add note. With the keyboard, move to a sentence with Tab and
							press Shift+F10.
						</p>
					</div>
				) : (
					<ul className="space-y-0.5 px-2 pb-3">
						{sorted.map((n, i) => {
							const heading =
								n.chapterId !== sorted[i - 1]?.chapterId
									? chapterTitle(n.chapterId)
									: null;
							return (
								<li key={n.id}>
									{heading ? (
										<p className="truncate px-2.5 pb-1 pt-3 text-xs font-medium text-muted-foreground">
											{heading}
										</p>
									) : null}
									<div
										className={cn(
											"group flex items-start gap-1 rounded-md pr-1 transition-colors hover:bg-accent",
											n.chapterId === chapterId && "bg-accent/30",
										)}
									>
										<button
											type="button"
											onClick={() => void jumpToNote(path, n)}
											className="flex min-w-0 flex-1 gap-2 px-2.5 py-2 text-left"
											title="Go to this passage"
										>
											<span
												aria-hidden
												className={cn(
													"mt-1 w-1 shrink-0 self-stretch rounded-full",
													`note-swatch-${n.color}`,
												)}
											/>
											<span className="min-w-0">
												<span className="line-clamp-3 text-sm leading-snug text-foreground">
													{n.text}
												</span>
												{n.note ? (
													<span className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-snug text-muted-foreground">
														{n.note}
													</span>
												) : null}
											</span>
										</button>
										<button
											type="button"
											onClick={() => setEditing(n)}
											aria-label={`${n.note ? "Edit note" : "Add note"}: ${n.text.slice(0, 40)}`}
											title={n.note ? "Edit note" : "Add note"}
											className="mt-1 shrink-0 rounded p-1.5 text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground"
										>
											<Pencil className="size-4" aria-hidden />
										</button>
										<button
											type="button"
											onClick={() => {
												remove(path, n.id);
												showToast({
													title: n.note ? "Note deleted" : "Highlight deleted",
													action: {
														label: "Undo",
														onClick: () =>
															useNotesStore.getState().upsert(path, n),
													},
													durationMs: 8000,
												});
											}}
											aria-label={`Delete highlight: ${n.text.slice(0, 40)}`}
											title="Delete highlight"
											className="mt-1 shrink-0 rounded p-1.5 text-muted-foreground/70 transition-colors hover:bg-destructive/15 hover:text-destructive"
										>
											<Trash2 className="size-4" aria-hidden />
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</ScrollArea>
			{editing ? (
				<NoteDialog
					path={path}
					note={editing}
					isNew={false}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</>
	);
}
