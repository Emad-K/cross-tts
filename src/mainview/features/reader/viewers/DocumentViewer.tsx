import { lazy, Suspense, useRef, useState } from "react";
import type { Note } from "@shared/notes";
import type { LoadedDocument } from "../types";
import { seekToChunkAndPlay, useTtsStore } from "../tts";
import { ViewerContextMenu } from "../contextMenu/ViewerContextMenu";
import { NoteDialog } from "../notes/NoteDialog";
import { NotesHighlighter } from "../notes/NotesHighlighter";
import { getNoteLocation, useNotesStore } from "../notes/notesStore";
import {
	type NoteTarget,
	captureNoteTarget,
	saveHighlight,
} from "../notes/viewerNotes";
import { FixPronunciationDialog } from "../ttsRules/FixPronunciationDialog";
import { EpubViewer } from "./EpubViewer";
import { TxtViewer } from "./TxtViewer";

const LookupDialog = lazy(() => import("../contextMenu/LookupDialog"));

type DocumentViewerProps = {
	document: LoadedDocument;
	activeChapterId: string | null;
};

type MenuState = { x: number; y: number; selection: string } & NoteTarget;

/**
 * Routes the active {@link LoadedDocument} to the correct viewer and hosts
 * the shared right-click menu (Copy / Find / Look up / Highlight / notes /
 * Fix pronunciation) for both viewers, plus the saved highlights painted over them.
 */
export function DocumentViewer({
	document,
	activeChapterId,
}: DocumentViewerProps) {
	const highlightRange = useTtsStore((s) => s.highlightRange);
	const chunks = useTtsStore((s) => s.chunks);
	const currentChunkIndex = useTtsStore((s) => s.currentChunkIndex);
	const [menu, setMenu] = useState<MenuState | null>(null);
	const [lookupWord, setLookupWord] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const [noteEdit, setNoteEdit] = useState<{
		path: string;
		note: Note;
		isNew: boolean;
	} | null>(null);
	const [fixWord, setFixWord] = useState<string | null>(null);
	/** Open the note dialog for a draft or saved highlight of the open book. */
	const editNote = (note: Note, isNew: boolean) => {
		const { path } = getNoteLocation();
		if (path) setNoteEdit({ path, note, isNew });
	};

	const renderViewer = () => {
		switch (document.format) {
			case "txt":
				return (
					<TxtViewer
						text={document.text}
						highlightRange={highlightRange}
						chunks={chunks}
						activeChunkIndex={currentChunkIndex}
						onChunkClick={(i) => seekToChunkAndPlay(i)}
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
						onChunkClick={(i) => seekToChunkAndPlay(i)}
					/>
				);
		}
	};

	return (
		// Suppress Electron's default (empty) context menu and show ours.
		// Right click never reaches the chunk spans' onClick, so it cannot
		// trigger seek-to-chunk; preventDefault keeps the selection intact.
		<div
			ref={rootRef}
			onContextMenu={(e) => {
				// Dialogs opened from here are portals: their events bubble through
				// React to this div, but they are not part of the page text.
				if (!rootRef.current?.contains(e.target as Node)) return;
				e.preventDefault();
				setMenu({
					x: e.clientX,
					y: e.clientY,
					selection: window.getSelection()?.toString() ?? "",
					...captureNoteTarget(rootRef.current, e.clientX, e.clientY),
				});
			}}
		>
			{renderViewer()}
			<NotesHighlighter rootRef={rootRef} />
			{menu ? (
				<ViewerContextMenu
					x={menu.x}
					y={menu.y}
					selection={menu.selection}
					onClose={() => setMenu(null)}
					onLookup={(word) => setLookupWord(word)}
					onHighlight={
						menu.draft
							? (color) => saveHighlight(menu.draft!, color)
							: undefined
					}
					onAddNote={menu.draft ? () => editNote(menu.draft!, true) : undefined}
					onEditNote={
						menu.existing && !menu.draft
							? () => editNote(menu.existing!, false)
							: undefined
					}
					onRemoveNote={
						menu.existing && !menu.draft
							? () => {
									const { path } = getNoteLocation();
									if (path) {
										useNotesStore.getState().remove(path, menu.existing!.id);
									}
								}
							: undefined
					}
					onFixPronunciation={setFixWord}
				/>
			) : null}
			{noteEdit ? (
				<NoteDialog {...noteEdit} onClose={() => setNoteEdit(null)} />
			) : null}
			{fixWord ? (
				<FixPronunciationDialog
					word={fixWord}
					onClose={() => setFixWord(null)}
				/>
			) : null}
			{lookupWord ? (
				<Suspense fallback={null}>
					<LookupDialog
						word={lookupWord}
						onClose={() => setLookupWord(null)}
					/>
				</Suspense>
			) : null}
		</div>
	);
}
