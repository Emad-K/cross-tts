import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import type { ReaderChapter } from "../types";

const ROW_HEIGHT_PX = 44;
const OVERSCAN_ROWS = 8;
const VIRTUALIZE_THRESHOLD = 80;

const SCROLL_AREA_VIEWPORT_SELECTOR = "[data-radix-scroll-area-viewport]";

export type VirtualChapterListProps = {
	chapters: ReaderChapter[];
	activeChapterId: string | null;
	onSelectChapter: (chapterId: string) => void;
};

function ChapterRow({
	chapter,
	active,
	onSelect,
}: {
	chapter: ReaderChapter;
	active: boolean;
	onSelect: () => void;
}) {
	const level = chapter.level ?? 0;
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"w-full rounded-md px-3 py-2 text-left text-sm leading-snug transition-colors",
				"hover:bg-accent/80 hover:text-accent-foreground",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				active && "bg-accent text-accent-foreground shadow-sm",
				!active && "text-foreground/85",
			)}
			style={{ paddingLeft: `${0.75 + level * 0.75}rem` }}
			aria-current={active ? "location" : undefined}
			title={chapter.title}
		>
			<span className="line-clamp-2">{chapter.title}</span>
		</button>
	);
}

/** Binds to the parent shadcn/Radix ScrollArea viewport (not native overflow). */
function useScrollAreaViewport(anchorRef: RefObject<HTMLElement | null>) {
	const [viewport, setViewport] = useState<HTMLElement | null>(null);

	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		if (!anchor) {
			setViewport(null);
			return;
		}
		const vp = anchor.closest(SCROLL_AREA_VIEWPORT_SELECTOR);
		setViewport(vp instanceof HTMLElement ? vp : null);
	});

	return viewport;
}

export function VirtualChapterList({
	chapters,
	activeChapterId,
	onSelectChapter,
}: VirtualChapterListProps) {
	const anchorRef = useRef<HTMLElement>(null);
	const viewport = useScrollAreaViewport(anchorRef);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(0);

	const useVirtual = chapters.length >= VIRTUALIZE_THRESHOLD;

	const updateViewport = useCallback(() => {
		if (!viewport) return;
		setViewportHeight(viewport.clientHeight);
		setScrollTop(viewport.scrollTop);
	}, [viewport]);

	useEffect(() => {
		if (!viewport) return;
		updateViewport();
		viewport.addEventListener("scroll", updateViewport, { passive: true });
		const ro = new ResizeObserver(updateViewport);
		ro.observe(viewport);
		return () => {
			viewport.removeEventListener("scroll", updateViewport);
			ro.disconnect();
		};
	}, [viewport, updateViewport, chapters.length]);

	useEffect(() => {
		if (!useVirtual || !viewport || activeChapterId == null) return;
		const index = chapters.findIndex((c) => c.id === activeChapterId);
		if (index < 0) return;
		const rowTop = index * ROW_HEIGHT_PX;
		const rowBottom = rowTop + ROW_HEIGHT_PX;
		if (rowTop < viewport.scrollTop) {
			viewport.scrollTop = rowTop;
		} else if (rowBottom > viewport.scrollTop + viewport.clientHeight) {
			viewport.scrollTop = rowBottom - viewport.clientHeight;
		}
		updateViewport();
	}, [activeChapterId, chapters, useVirtual, viewport, updateViewport]);

	if (!useVirtual) {
		return (
			<nav ref={anchorRef} className="px-2 py-2" aria-label="Chapter list">
				<ul className="flex flex-col gap-0.5">
					{chapters.map((chapter, index) => (
						<li key={`${chapter.id}-${index}`}>
							<ChapterRow
								chapter={chapter}
								active={chapter.id === activeChapterId}
								onSelect={() => onSelectChapter(chapter.id)}
							/>
						</li>
					))}
				</ul>
			</nav>
		);
	}

	const totalHeight = chapters.length * ROW_HEIGHT_PX;
	const startRow = Math.max(
		0,
		Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS,
	);
	const visibleCount =
		Math.ceil(viewportHeight / ROW_HEIGHT_PX) + OVERSCAN_ROWS * 2;
	const endRow = Math.min(chapters.length, startRow + visibleCount);

	return (
		<nav ref={anchorRef} className="px-2 py-2" aria-label="Chapter list">
			<ul className="relative w-full" style={{ height: totalHeight }}>
				{chapters.slice(startRow, endRow).map((chapter, i) => {
					const rowIndex = startRow + i;
					return (
						<li
							key={`${chapter.id}-${rowIndex}`}
							className="absolute left-0 right-0 px-0"
							style={{
								top: rowIndex * ROW_HEIGHT_PX,
								height: ROW_HEIGHT_PX,
							}}
						>
							<ChapterRow
								chapter={chapter}
								active={chapter.id === activeChapterId}
								onSelect={() => onSelectChapter(chapter.id)}
							/>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
