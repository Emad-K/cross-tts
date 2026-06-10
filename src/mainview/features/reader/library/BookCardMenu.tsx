import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { BookProgress } from "@shared/recentBooks";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseTagsInput } from "./libraryFilters";

export type BookDetails = { series?: string; tags?: string[] };

/**
 * Per-card kebab menu: "Edit details…" (series + tags) and
 * "Remove from library" (with confirm; never touches the file on disk).
 */
export function BookCardMenu({
	book,
	onRemove,
	onSaveDetails,
}: {
	book: BookProgress;
	onRemove: () => void;
	onSaveDetails: (details: BookDetails) => void;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const [series, setSeries] = useState("");
	const [tagsText, setTagsText] = useState("");

	const openEdit = () => {
		setSeries(book.series ?? "");
		setTagsText((book.tags ?? []).join(", "));
		setEditOpen(true);
	};

	const saveDetails = () => {
		onSaveDetails({ series: series.trim(), tags: parseTagsInput(tagsText) });
		setEditOpen(false);
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label={`Options for ${book.title}`}
						title="Book options"
						className="absolute right-1.5 top-1.5 rounded-full bg-background/85 p-1 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition hover:bg-accent hover:text-accent-foreground focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
						onClick={(e) => e.stopPropagation()}
					>
						<MoreVertical className="size-3.5" aria-hidden />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
					<DropdownMenuItem onSelect={openEdit}>
						<Pencil className="mr-2 size-4" aria-hidden />
						Edit details…
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						className="text-destructive focus:text-destructive"
						onSelect={() => setConfirmOpen(true)}
					>
						<Trash2 className="mr-2 size-4" aria-hidden />
						Remove from library
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Remove from library?</DialogTitle>
						<DialogDescription>
							“{book.title}” will be removed from your library, along with its
							reading progress. The file stays on your computer.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setConfirmOpen(false)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={() => {
								setConfirmOpen(false);
								onRemove();
							}}
						>
							Remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Edit details</DialogTitle>
						<DialogDescription className="truncate">
							{book.title}
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-4"
						onSubmit={(e) => {
							e.preventDefault();
							saveDetails();
						}}
					>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="book-series">Series</Label>
							<Input
								id="book-series"
								value={series}
								onChange={(e) => setSeries(e.target.value)}
								placeholder="e.g. Discworld"
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="book-tags">Tags</Label>
							<Input
								id="book-tags"
								value={tagsText}
								onChange={(e) => setTagsText(e.target.value)}
								placeholder="fantasy, to-read"
							/>
							<p className="text-xs text-muted-foreground">
								Separate tags with commas.
							</p>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setEditOpen(false)}
							>
								Cancel
							</Button>
							<Button type="submit">Save</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
