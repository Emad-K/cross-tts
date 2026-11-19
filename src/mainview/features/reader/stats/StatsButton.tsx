import { BarChart3 } from "lucide-react";
import { useState } from "react";
import type { BookProgress } from "@shared/recentBooks";
import { STREAK_MIN_SEC, streak, weekSeconds } from "@shared/readingStats";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLibraryStore } from "../library/libraryStore";
import { formatListened } from "./formatListened";
import { useStatsStore } from "./statsStore";

const percent = (progress: number | undefined) =>
	Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100);

const shortDate = (ms: number) =>
	new Date(ms).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});

/**
 * Line under a library card: "34% · 2 h 10 m", or the finish date once the
 * book was played to the end. Renders nothing for a book not started.
 */
export function BookStatsLine({ book }: { book: BookProgress }) {
	const stats = useStatsStore((s) => s.stats.books[book.path]);
	const pct = percent(book.progress);
	const parts = [
		stats?.finishedAt ? `Finished ${shortDate(stats.finishedAt)}` : pct > 0 ? `${pct}%` : null,
		stats && stats.listenedSec >= 60 ? formatListened(stats.listenedSec) : null,
	].filter(Boolean);
	if (parts.length === 0) return null;
	return (
		<span className="-mt-1.5 w-full truncate text-xs tabular-nums text-muted-foreground">
			{parts.join(" · ")}
		</span>
	);
}

function Figure({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border border-border bg-muted/20 px-3 py-2">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="text-lg font-semibold tabular-nums text-foreground">{value}</dd>
		</div>
	);
}

/** Library-header button that opens the listening stats. */
export function StatsButton() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="gap-2 border-border bg-transparent"
				onClick={() => setOpen(true)}
				title="Listening stats"
			>
				<BarChart3 className="size-4" aria-hidden />
				Stats
			</Button>
			{open ? <StatsDialog onClose={() => setOpen(false)} /> : null}
		</>
	);
}

function StatsDialog({ onClose }: { onClose: () => void }) {
	const stats = useStatsStore((s) => s.stats);
	const books = useLibraryStore((s) => s.books);
	const now = new Date();
	const days = streak(stats, now);
	const total = Object.values(stats.days).reduce((a, b) => a + b, 0);
	const finished = Object.values(stats.books).filter((b) => b.finishedAt).length;
	// Books still in the library that were listened to, most-listened first.
	const rows = Object.entries(stats.books)
		.filter(([path]) => books[path])
		.sort(([, a], [, b]) => b.listenedSec - a.listenedSec);

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Listening stats</DialogTitle>
					<DialogDescription>
						Counted on this computer while audio plays. Nothing is sent
						anywhere.
					</DialogDescription>
				</DialogHeader>
				<dl className="grid grid-cols-2 gap-2">
					<Figure label="Past 7 days" value={formatListened(weekSeconds(stats, now))} />
					<Figure
						label={`Streak (days with ${STREAK_MIN_SEC / 60}+ min)`}
						value={`${days} ${days === 1 ? "day" : "days"}`}
					/>
					<Figure label="All time" value={formatListened(total)} />
					<Figure label="Books finished" value={String(finished)} />
				</dl>
				{rows.length === 0 ? (
					<p className="py-4 text-center text-sm text-muted-foreground">
						Play a book and your listening time shows up here.
					</p>
				) : (
					<ScrollArea className="max-h-[40vh]">
						<table className="w-full text-sm">
							<thead className="text-left text-xs text-muted-foreground">
								<tr>
									<th scope="col" className="py-1 pr-2 font-medium">Book</th>
									<th scope="col" className="px-2 py-1 text-right font-medium">Read</th>
									<th scope="col" className="px-2 py-1 text-right font-medium">Listened</th>
									<th scope="col" className="py-1 pl-2 text-right font-medium">Finished</th>
								</tr>
							</thead>
							<tbody>
								{rows.map(([path, b]) => (
									<tr key={path} className="border-t border-border">
										<td className="max-w-[12rem] truncate py-1.5 pr-2" title={books[path]!.title}>
											{books[path]!.title}
										</td>
										<td className="px-2 py-1.5 text-right tabular-nums">
											{percent(books[path]!.progress)}%
										</td>
										<td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
											{formatListened(b.listenedSec)}
										</td>
										<td className="whitespace-nowrap py-1.5 pl-2 text-right text-muted-foreground">
											{b.finishedAt ? shortDate(b.finishedAt) : "–"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</ScrollArea>
				)}
			</DialogContent>
		</Dialog>
	);
}
