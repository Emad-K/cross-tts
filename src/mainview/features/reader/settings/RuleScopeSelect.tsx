import { create } from "zustand";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useLibraryStore } from "../library/libraryStore";
import { useTtsRulesStore } from "../ttsRules/ttsRulesStore";

/** A book's library title, or its file name when it isn't in the library. */
function useBookTitle(path: string | null | undefined): string {
	const title = useLibraryStore((s) => (path ? s.books[path]?.title : undefined));
	return title ?? path?.split(/[\\/]/).pop() ?? "";
}

/**
 * "Applies to: All books / This book" for one rule. `value` is the book path a
 * rule is limited to (undefined = all books). A rule that belongs to a book
 * other than the open one keeps that book as a third choice.
 */
export function RuleScopeSelect({
	id,
	value,
	onChange,
}: {
	id: string;
	value: string | undefined;
	onChange: (book: string | undefined) => void;
}) {
	const currentBook = useTtsRulesStore((s) => s.currentBook);
	const currentTitle = useBookTitle(currentBook);
	const otherBook = value && value !== currentBook ? value : null;
	const otherTitle = useBookTitle(otherBook);
	const noChoice = !currentBook && !otherBook;
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Label htmlFor={id} className="text-sm">
				Applies to
			</Label>
			<select
				id={id}
				value={value ?? ""}
				onChange={(e) => onChange(e.target.value || undefined)}
				disabled={noChoice}
				title={noChoice ? "Open a book to limit a rule to it." : undefined}
				className="h-8 min-w-0 max-w-full flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
			>
				<option value="">All books</option>
				{currentBook ? (
					<option value={currentBook}>This book ({currentTitle})</option>
				) : null}
				{otherBook ? (
					<option value={otherBook}>Only “{otherTitle}”</option>
				) : null}
			</select>
		</div>
	);
}

/** Small tag on a rule row that is limited to one book. */
export function RuleScopeBadge({ book }: { book: string | undefined }) {
	const currentBook = useTtsRulesStore((s) => s.currentBook);
	const title = useBookTitle(book);
	if (!book) return null;
	return (
		<span
			className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
			title={`Only applies to “${title}”`}
		>
			{book === currentBook ? "This book" : title}
		</span>
	);
}

/** List filter shared by the rule lists (not persisted). */
export const useRuleScopeFilter = create<{
	thisBookOnly: boolean;
	setThisBookOnly: (v: boolean) => void;
}>((set) => ({
	thisBookOnly: false,
	setThisBookOnly: (thisBookOnly) => set({ thisBookOnly }),
}));

/** The rules to list: everything, or just the open book's own rules. */
export function useScopeFilteredRules<T extends { book?: string }>(rules: T[]): T[] {
	const currentBook = useTtsRulesStore((s) => s.currentBook);
	const thisBookOnly = useRuleScopeFilter((s) => s.thisBookOnly);
	return thisBookOnly && currentBook
		? rules.filter((r) => r.book === currentBook)
		: rules;
}

/** "Only this book's rules" checkbox; hidden when no book is open. */
export function RuleScopeFilter({ id }: { id: string }) {
	const currentBook = useTtsRulesStore((s) => s.currentBook);
	const { thisBookOnly, setThisBookOnly } = useRuleScopeFilter();
	if (!currentBook) return null;
	return (
		<div className="flex items-center gap-2">
			<Checkbox
				id={id}
				checked={thisBookOnly}
				onCheckedChange={(v) => setThisBookOnly(v === true)}
			/>
			<Label htmlFor={id} className="cursor-pointer text-sm font-normal">
				Only show this book's rules
			</Label>
		</div>
	);
}
