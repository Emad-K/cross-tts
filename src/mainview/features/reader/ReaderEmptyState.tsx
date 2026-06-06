import { BookOpen, FileText, FolderOpen, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { BookProgress } from "@shared/recentBooks";
import { recentBooksList } from "@shared/recentBooks";
import { getBookCover } from "@/lib/desktopBridge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "./library/libraryStore";

/** Covers are immutable per file; cache so the grid fetches each one once. */
const coverCache = new Map<string, string | null>();

function useBookCover(book: BookProgress): string | null {
	const [url, setUrl] = useState<string | null>(
		() => coverCache.get(book.path) ?? null,
	);
	useEffect(() => {
		if (book.format !== "epub") return;
		if (coverCache.has(book.path)) {
			setUrl(coverCache.get(book.path) ?? null);
			return;
		}
		let alive = true;
		void getBookCover(book.path).then((u) => {
			coverCache.set(book.path, u);
			if (alive) setUrl(u);
		});
		return () => {
			alive = false;
		};
	}, [book.path, book.format]);
	return url;
}

export type ReaderEmptyStateProps = {
	onOpenFile: () => void;
	onLoadSample?: () => void;
	/** Resume a book from the library grid. */
	onOpenBook?: (path: string) => void;
	className?: string;
};

/** Stable hue from the title, for the placeholder cover. */
function titleHue(title: string): number {
	let h = 0;
	for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
	return h;
}

function CoverCard({
	book,
	onOpen,
}: {
	book: BookProgress;
	onOpen: () => void;
}) {
	const hue = titleHue(book.title);
	const cover = useBookCover(book);
	return (
		<button
			type="button"
			onClick={onOpen}
			className="group flex flex-col gap-2 text-left focus:outline-none"
			title={book.title}
		>
			<div
				className={cn(
					"relative flex aspect-[2/3] items-center justify-center overflow-hidden rounded-lg border border-border shadow-sm transition-transform group-hover:-translate-y-0.5 group-hover:shadow-md",
					!cover && "p-3",
				)}
				style={
					cover
						? undefined
						: {
								backgroundImage: `linear-gradient(160deg, hsl(${hue} 45% 38%), hsl(${(hue + 40) % 360} 50% 22%))`,
							}
				}
			>
				{cover ? (
					<img
						src={cover}
						alt={book.title}
						className="size-full object-cover"
						loading="lazy"
						decoding="async"
					/>
				) : (
					<>
						<span className="line-clamp-4 text-center text-sm font-semibold leading-snug text-white/95">
							{book.title}
						</span>
						<span className="absolute bottom-1.5 right-2 text-[10px] font-medium uppercase tracking-wide text-white/60">
							{book.format}
						</span>
					</>
				)}
			</div>
			<span
				className="truncate text-sm font-medium text-foreground"
				title={book.title}
			>
				{book.title}
			</span>
		</button>
	);
}

/**
 * Home screen with no document open: a "My Books" grid of previously-opened
 * books (click to resume) plus Open file. Falls back to a simple prompt when
 * the library is empty.
 */
export function ReaderEmptyState({
	onOpenFile,
	onLoadSample,
	onOpenBook,
	className,
}: ReaderEmptyStateProps) {
	const books = useLibraryStore((s) => s.books);
	const library = recentBooksList(books);

	if (library.length === 0 || !onOpenBook) {
		return (
			<div
				className={cn(
					"flex flex-1 flex-col items-center justify-center px-4 py-16 text-center",
					className,
				)}
			>
				<div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-border bg-muted/40 shadow-sm">
					<BookOpen className="size-8 text-muted-foreground" aria-hidden />
				</div>
				<h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					Open a document
				</h1>
				<p className="mb-2 max-w-md text-sm text-muted-foreground sm:text-base">
					Open a plain text or EPUB book to read and listen with TTS.
				</p>
				<p className="mb-8 flex items-center justify-center gap-2 text-xs text-muted-foreground/90 sm:text-sm">
					<FileText className="size-4 shrink-0" aria-hidden />
					<span>.txt and .epub supported</span>
				</p>
				<div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">
					<Button
						type="button"
						size="lg"
						className="gap-2 sm:min-w-[11rem]"
						onClick={onOpenFile}
					>
						<FolderOpen className="size-4" aria-hidden />
						Open file
					</Button>
					{onLoadSample ? (
						<Button
							type="button"
							size="lg"
							variant="outline"
							className="border-border sm:min-w-[11rem]"
							onClick={onLoadSample}
						>
							Try sample
						</Button>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div className={cn("flex-1 overflow-y-auto px-6 py-8", className)}>
			<div className="mx-auto w-full max-w-5xl">
				<div className="mb-5 flex items-center justify-between gap-3">
					<h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
						My books
					</h1>
					<Button
						type="button"
						size="sm"
						className="gap-2"
						onClick={onOpenFile}
					>
						<FolderOpen className="size-4" aria-hidden />
						Open file
					</Button>
				</div>

				<div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
					{library.map((b) => (
						<CoverCard
							key={b.path}
							book={b}
							onOpen={() => onOpenBook(b.path)}
						/>
					))}
					<button
						type="button"
						onClick={onOpenFile}
						className="group flex flex-col gap-2 text-left focus:outline-none"
						title="Open a file"
					>
						<div className="flex aspect-[2/3] items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-muted-foreground transition-colors group-hover:border-foreground/40 group-hover:bg-accent">
							<Plus className="size-7" aria-hidden />
						</div>
						<span className="truncate text-sm font-medium text-muted-foreground">
							Open file
						</span>
					</button>
				</div>
			</div>
		</div>
	);
}
