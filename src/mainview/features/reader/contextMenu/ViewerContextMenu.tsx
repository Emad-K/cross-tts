import { BookOpenText, Copy, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	collapseWhitespace,
	extractLookupWord,
	truncateMenuLabel,
} from "@shared/dictionary";
import { cn } from "@/lib/utils";
import { useFindStore } from "../find/findStore";

const VIEWPORT_MARGIN_PX = 8;

export type ViewerContextMenuProps = {
	/** Pointer position (viewport coordinates) of the right click. */
	x: number;
	y: number;
	/** Current text selection at the time of the right click ("" if none). */
	selection: string;
	onClose: () => void;
	/** Open the dictionary dialog for a word. */
	onLookup: (word: string) => void;
};

/**
 * Custom right-click menu for the reader viewers (Copy / Find / Look up).
 * Rendered into `document.body` at the pointer position; closes on
 * click-away, Escape, scroll, resize or window blur.
 */
export function ViewerContextMenu({
	x,
	y,
	selection,
	onClose,
	onLookup,
}: ViewerContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ x, y });

	// Keep the menu inside the viewport (right-clicks near edges).
	useLayoutEffect(() => {
		const el = menuRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		setPos({
			x: Math.max(
				VIEWPORT_MARGIN_PX,
				Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN_PX),
			),
			y: Math.max(
				VIEWPORT_MARGIN_PX,
				Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN_PX),
			),
		});
	}, [x, y]);

	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (menuRef.current?.contains(e.target as Node)) return;
			onClose();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		const close = () => onClose();
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("blur", close);
		window.addEventListener("resize", close);
		window.addEventListener("wheel", close, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("blur", close);
			window.removeEventListener("resize", close);
			window.removeEventListener("wheel", close, true);
		};
	}, [onClose]);

	const trimmed = selection.trim();
	const hasSelection = trimmed.length > 0;
	const lookupWord = extractLookupWord(trimmed);
	const findLabel = hasSelection
		? `Find “${truncateMenuLabel(trimmed)}”`
		: "Find in chapter";

	return createPortal(
		<div
			ref={menuRef}
			role="menu"
			aria-label="Reader context menu"
			style={{ left: pos.x, top: pos.y }}
			className={cn(
				"fixed z-50 min-w-[11rem] max-w-[18rem] overflow-hidden rounded-md border border-border",
				"bg-popover p-1 text-popover-foreground shadow-md",
			)}
			onContextMenu={(e) => e.preventDefault()}
		>
			{hasSelection ? (
				<MenuItem
					label="Copy"
					icon={<Copy aria-hidden />}
					onSelect={() => {
						void navigator.clipboard.writeText(selection);
						onClose();
					}}
				/>
			) : null}
			<MenuItem
				label={findLabel}
				icon={<Search aria-hidden />}
				onSelect={() => {
					useFindStore
						.getState()
						.openFind(hasSelection ? collapseWhitespace(trimmed) : undefined);
					onClose();
				}}
			/>
			{lookupWord ? (
				<MenuItem
					label={`Look up “${truncateMenuLabel(lookupWord)}”`}
					icon={<BookOpenText aria-hidden />}
					onSelect={() => {
						onLookup(lookupWord);
						onClose();
					}}
				/>
			) : null}
		</div>,
		document.body,
	);
}

function MenuItem({
	label,
	icon,
	onSelect,
}: {
	label: string;
	icon: React.ReactNode;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			onClick={onSelect}
			className={cn(
				"flex w-full select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
				"hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
				"[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
			)}
		>
			{icon}
			<span className="min-w-0 flex-1 truncate">{label}</span>
		</button>
	);
}
