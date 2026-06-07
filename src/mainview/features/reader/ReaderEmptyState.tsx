import { ArrowDownUp, BookOpen, FileText, FolderOpen, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { BookProgress } from "@shared/recentBooks";
import { recentBooksList } from "@shared/recentBooks";
import { getBookCover } from "@/lib/desktopBridge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "./library/libraryStore";
import { touchSessionSave } from "./sessionPersistence";

type SortKey = "recent" | "title" | "progress";

const SORT_LABELS: Record<SortKey, string> = {
	recent: "Recent",
	title: "Title",
	progress: "Progress",
};

function sortLibrary(list: BookProgress[], sort: SortKey): BookProgress[] {
	if (sort === "title") {
		return [...list].sort((a, b) => a.title.localeCompare(b.title));
	}
	if (sort === "progress") {
		return [...list].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
	}
	return list; // recentBooksList is already most-recent-first
}

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
	onRemove,
}: {
	book: BookProgress;
	onOpen: () => void;
	onRemove: () => void;
}) {
	const hue = titleHue(book.title);
	const cover = useBookCover(book);
	const pct = Math.round(Math.min(1, Math.max(0, book.progress ?? 0)) * 100);
	return (
		<div className="group relative">
			<button
				type="button"
				onClick={onOpen}
				className="flex w-full min-w-0 flex-col gap-2 text-left focus:outline-none"
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
					{/* Read-progress bar. */}
					{pct > 0 ? (
						<div
							className="absolute inset-x-0 bottom-0 h-1 bg-black/40"
							title={`${pct}% read`}
						>
							<div
								className="h-full bg-primary"
								style={{ width: `${pct}%` }}
							/>
						</div>
					) : null}
				</div>
				<span className="w-full truncate text-sm font-medium text-foreground">
					{book.title}
				</span>
			</button>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onRemove();
				}}
				aria-label="Remove from library"
				title="Remove from library"
				className="absolute right-1.5 top-1.5 rounded-full bg-background/85 p-1 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition hover:bg-destructive hover:text-destructive-foreground focus:opacity-100 group-hover:opacity-100"
			>
				<X className="size-3.5" aria-hidden />
			</button>
		</div>
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
	const removeBook = useLibraryStore((s) => s.removeBook);
	const library = recentBooksList(books);
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<SortKey>("recent");

	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		const filtered = q
			? library.filter((b) => b.title.toLowerCase().includes(q))
			: library;
		return sortLibrary(filtered, sort);
	}, [library, query, sort]);

	const onRemove = (path: string) => {
		removeBook(path);
		touchSessionSave();
	};

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
				<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
						My books
					</h1>
					<div className="flex items-center gap-2">
						<div className="relative">
							<Search
								className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
								aria-hidden
							/>
							<Input
								type="search"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Search books…"
								className="h-9 w-44 pl-8 sm:w-56"
								aria-label="Search books"
							/>
						</div>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="gap-2 border-border bg-transparent"
									title="Sort books"
								>
									<ArrowDownUp className="size-4" aria-hidden />
									{SORT_LABELS[sort]}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuRadioGroup
									value={sort}
									onValueChange={(v) => setSort(v as SortKey)}
								>
									<DropdownMenuRadioItem value="recent">
										Recent
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="title">
										Title
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="progress">
										Progress
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				{shown.length === 0 ? (
					<p className="py-12 text-center text-sm text-muted-foreground">
						No books match “{query}”.
					</p>
				) : (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-5 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
						{shown.map((b) => (
							<CoverCard
								key={b.path}
								book={b}
								onOpen={() => onOpenBook(b.path)}
								onRemove={() => onRemove(b.path)}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
