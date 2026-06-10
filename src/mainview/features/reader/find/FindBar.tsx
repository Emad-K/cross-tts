import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
	findInPage,
	stopFindInPage,
	subscribeFoundInPage,
} from "@/lib/desktopBridge";
import { cn } from "@/lib/utils";

/**
 * In-chapter find bar. Uses Electron's native findInPage (highlight + scroll)
 * via IPC; the match counter comes back over the found-in-page event.
 *
 * `initialQuery` pre-fills the input and runs the search on mount (used by
 * the viewer context menu); remount (new `key`) to apply a new one.
 */
export function FindBar({
	onClose,
	initialQuery = "",
}: {
	onClose: () => void;
	initialQuery?: string;
}) {
	const [text, setText] = useState(initialQuery);
	const [matches, setMatches] = useState(0);
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	// Mount-only: focus, select any pre-filled text and start that search.
	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
		if (initialQuery) findInPage(initialQuery, { findNext: false });
	}, []);

	useEffect(
		() =>
			subscribeFoundInPage((r) => {
				setMatches(r.matches);
				setActive(r.activeMatchOrdinal);
			}),
		[],
	);

	// Clear the native selection/highlights when the bar closes.
	useEffect(() => () => stopFindInPage(), []);

	const search = (q: string) => {
		setText(q);
		if (q) {
			findInPage(q, { findNext: false });
		} else {
			stopFindInPage();
			setMatches(0);
			setActive(0);
		}
	};

	const step = (forward: boolean) => {
		if (text) findInPage(text, { forward, findNext: true });
	};

	return (
		<div className="absolute right-4 top-3 z-30 flex items-center gap-0.5 rounded-lg border border-border bg-background/95 p-1 shadow-md backdrop-blur">
			<Input
				ref={inputRef}
				value={text}
				onChange={(e) => search(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						step(!e.shiftKey);
					} else if (e.key === "Escape") {
						e.preventDefault();
						onClose();
					}
				}}
				placeholder="Find in chapter…"
				className="h-8 w-44 border-0 shadow-none focus-visible:ring-0"
				aria-label="Find in chapter"
			/>
			<span className="min-w-[3.25rem] px-1 text-center text-xs tabular-nums text-muted-foreground">
				{text ? `${matches ? active : 0}/${matches}` : ""}
			</span>
			<FindButton
				label="Previous match"
				onClick={() => step(false)}
				disabled={matches === 0}
			>
				<ChevronUp className="size-4" aria-hidden />
			</FindButton>
			<FindButton
				label="Next match"
				onClick={() => step(true)}
				disabled={matches === 0}
			>
				<ChevronDown className="size-4" aria-hidden />
			</FindButton>
			<FindButton label="Close find" onClick={onClose}>
				<X className="size-4" aria-hidden />
			</FindButton>
		</div>
	);
}

function FindButton({
	label,
	onClick,
	disabled,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground",
				"disabled:pointer-events-none disabled:opacity-40",
			)}
		>
			{children}
		</button>
	);
}
