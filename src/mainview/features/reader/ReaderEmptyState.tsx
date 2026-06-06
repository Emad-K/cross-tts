import { BookOpen, FileText, FolderOpen } from "lucide-react";
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
			className="group flex w-full min-w-0 flex-col gap-2 text-left focus:outline-none"
			title={book.title}
		>
			<div
				className="relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-border shadow-sm transition-transform group-hover:-translate-y-0.5 group-hover:shadow-md"
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
					<div className="flex size-full items-center justify-center p-3">
						<span className="line-clamp-5 text-center text-sm font-semibold leading-snug text-white/95">
							{book.title}
						</span>
					</div>
				)}
				{/* Full title on hover (the label below is truncated). */}
				<div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2.5 pt-8 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
					<span className="line-clamp-3 text-xs font-medium leading-snug text-white">
						{book.title}
					</span>
				</div>
			</div>
			<span className="w-full truncate text-sm font-medium text-foreground">
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
			<div className="mx-auto w-full max-w-6xl">
				<h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
					My books
				</h1>

				<div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-5 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
					{library.map((b) => (
						<CoverCard
							key={b.path}
							book={b}
							onOpen={() => onOpenBook(b.path)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
