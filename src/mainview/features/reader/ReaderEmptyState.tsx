import { ArrowDownUp, BookOpen, FileText, FolderOpen, Search } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { type BookDetails, BookCardMenu } from "./library/BookCardMenu";
import {
	collectLibraryTags,
	filterLibrary,
	LIBRARY_SORT_LABELS,
	type LibrarySortKey,
	sortLibrary,
} from "./library/libraryFilters";
import { useLibraryStore } from "./library/libraryStore";
import { touchSessionSave } from "./sessionPersistence";

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
	onSaveDetails,
}: {
	book: BookProgress;
	onOpen: () => void;
	onRemove: () => void;
	onSaveDetails: (details: BookDetails) => void;
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
				{book.series ? (
					<span className="-mt-1.5 w-full truncate text-xs text-muted-foreground">
						{book.series}
					</span>
				) : null}
			</button>
			<BookCardMenu book={book} onRemove={onRemove} onSaveDetails={onSaveDetails} />
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
	const setBookDetails = useLibraryStore((s) => s.setBookDetails);
	const library = recentBooksList(books);
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<LibrarySortKey>("recent");
	const [activeTag, setActiveTag] = useState<string | null>(null);

	const allTags = useMemo(() => collectLibraryTags(library), [library]);
	const shown = useMemo(() => {
		const tag = activeTag !== null && allTags.includes(activeTag) ? activeTag : null;
		return sortLibrary(filterLibrary(library, query, tag), sort);
	}, [library, query, sort, activeTag, allTags]);

	const onRemove = (path: string) => {
		removeBook(path);
		touchSessionSave();
	};

	const onSaveDetails = (path: string, details: BookDetails) => {
		setBookDetails(path, details);
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
		<ScrollArea className={cn("min-h-0 flex-1", className)}>
			<div className="mx-auto w-full max-w-6xl px-6 py-8">
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
									{LIBRARY_SORT_LABELS[sort]}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuRadioGroup
									value={sort}
									onValueChange={(v) => setSort(v as LibrarySortKey)}
								>
									<DropdownMenuRadioItem value="recent">
										{LIBRARY_SORT_LABELS.recent}
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="title">
										{LIBRARY_SORT_LABELS.title}
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="progress">
										{LIBRARY_SORT_LABELS.progress}
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				{allTags.length > 0 ? (
					<div className="mb-5 flex flex-wrap items-center gap-1.5">
						{allTags.map((tag) => {
							const active = tag === activeTag;
							return (
								<button
									key={tag}
									type="button"
									aria-pressed={active}
									onClick={() => setActiveTag(active ? null : tag)}
									className={cn(
										"rounded-full border px-2.5 py-0.5 text-xs transition-colors",
										active
											? "border-primary bg-primary text-primary-foreground"
											: "border-border bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
									)}
								>
									{tag}
								</button>
							);
						})}
					</div>
				) : null}

				{shown.length === 0 ? (
					<p className="py-12 text-center text-sm text-muted-foreground">
						{query.trim()
							? `No books match “${query}”.`
							: "No books match the selected filter."}
					</p>
				) : (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-5 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
						{shown.map((b) => (
							<CoverCard
								key={b.path}
								book={b}
								onOpen={() => onOpenBook(b.path)}
								onRemove={() => onRemove(b.path)}
								onSaveDetails={(details) => onSaveDetails(b.path, details)}
							/>
						))}
					</div>
				)}
			</div>
		</ScrollArea>
	);
}
