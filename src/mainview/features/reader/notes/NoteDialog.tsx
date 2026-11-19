import { useState } from "react";
import {
	MAX_NOTE_BODY,
	NOTE_COLORS,
	type Note,
	type NoteColor,
} from "@shared/notes";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useNotesStore } from "./notesStore";
import "./notes.css";

/** Colour picker shared by the context menu and the note dialog. */
export function NoteColorSwatches({
	value,
	onPick,
	labelPrefix = "Highlight",
	role,
}: {
	/** Set when the swatches are items of a menu. */
	role?: "menuitem";
	value?: NoteColor;
	onPick: (color: NoteColor) => void;
	labelPrefix?: string;
}) {
	return (
		<span className="flex items-center gap-1.5">
			{NOTE_COLORS.map((color) => (
				<button
					key={color}
					type="button"
					role={role}
					aria-label={`${labelPrefix} ${color}`}
					aria-pressed={value === undefined ? undefined : value === color}
					title={`${labelPrefix} ${color}`}
					onClick={() => onPick(color)}
					className={cn(
						"size-5 rounded-full border border-black/20 outline-none ring-offset-2 ring-offset-popover transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring",
						`note-swatch-${color}`,
						value === color && "ring-2 ring-foreground",
					)}
				/>
			))}
		</span>
	);
}

/** Write or edit the note on a highlight. `isNew` means the highlight isn't saved yet. */
export function NoteDialog({
	path,
	note,
	isNew,
	onClose,
}: {
	path: string;
	note: Note;
	isNew: boolean;
	onClose: () => void;
}) {
	const [body, setBody] = useState(note.note ?? "");
	const [color, setColor] = useState<NoteColor>(note.color);

	const save = () => {
		useNotesStore.getState().upsert(path, {
			...note,
			color,
			note: body.trim() || undefined,
			updatedAt: Date.now(),
		});
		if (isNew) window.getSelection()?.removeAllRanges();
		onClose();
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{isNew ? "Add note" : "Edit note"}</DialogTitle>
					<DialogDescription className="line-clamp-4 border-l-2 border-border pl-3 text-left italic">
						{note.text}
						{note.end - note.start > note.text.length ? "…" : ""}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-1.5">
					<Label htmlFor="note-body">Note</Label>
					<textarea
						id="note-body"
						autoFocus
						value={body}
						maxLength={MAX_NOTE_BODY}
						onChange={(e) => setBody(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
						}}
						rows={5}
						placeholder="What do you want to remember?"
						className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					/>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-sm font-medium">Colour</span>
					<NoteColorSwatches value={color} onPick={setColor} labelPrefix="Use" />
				</div>
				<DialogFooter className="gap-2 sm:space-x-0">
					{isNew ? null : (
						<Button
							type="button"
							variant="outline"
							className="sm:mr-auto"
							onClick={() => {
								useNotesStore.getState().remove(path, note.id);
								onClose();
							}}
						>
							Delete highlight
						</Button>
					)}
					<Button type="button" variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button type="button" onClick={save}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
