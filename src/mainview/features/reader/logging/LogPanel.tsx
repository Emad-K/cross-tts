import { AlertTriangle, Info, Trash2, XCircle } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { LogEntry, LogLevel } from "@shared/logEntry";
import { useLogStore } from "./logStore";

export type LogPanelProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

const LEVEL_META: Record<
	LogLevel,
	{ icon: typeof Info; cls: string; label: string }
> = {
	info: { icon: Info, cls: "text-sky-400", label: "Info" },
	warn: { icon: AlertTriangle, cls: "text-amber-400", label: "Warning" },
	error: { icon: XCircle, cls: "text-destructive", label: "Error" },
};

function formatTime(ts: number): string {
	const d = new Date(ts);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}

function LogRow({ entry }: { entry: LogEntry }) {
	const meta = LEVEL_META[entry.level];
	const Icon = meta.icon;
	return (
		<li className="flex gap-2.5 border-b border-border/50 px-1 py-2 last:border-b-0">
			<Icon className={cn("mt-0.5 size-4 shrink-0", meta.cls)} aria-hidden />
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-2">
					<span className="font-mono text-[10px] tabular-nums text-muted-foreground">
						{formatTime(entry.ts)}
					</span>
					{entry.source ? (
						<span className="rounded-sm bg-muted px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{entry.source}
						</span>
					) : null}
				</div>
				<p className="mt-0.5 break-words text-sm text-foreground/90">
					{entry.message}
				</p>
				{entry.detail ? (
					<p className="mt-0.5 break-words font-mono text-xs text-muted-foreground">
						{entry.detail}
					</p>
				) : null}
			</div>
		</li>
	);
}

export function LogPanel({ open, onOpenChange }: LogPanelProps) {
	const entries = useLogStore((s) => s.entries);
	const clear = useLogStore((s) => s.clear);
	const markRead = useLogStore((s) => s.markRead);

	useEffect(() => {
		if (open) markRead();
	}, [open, markRead]);

	// Newest first.
	const ordered = [...entries].reverse();

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				aria-describedby={undefined}
				className="flex h-[min(80vh,36rem)] max-h-[min(80vh,36rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0"
			>
				<div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4 pr-12">
					<div className="space-y-1">
						<DialogTitle className="text-base font-semibold leading-none">
							Activity & logs
						</DialogTitle>
						<p className="text-sm text-muted-foreground">
							Model downloads, playback, and storage events appear here.
						</p>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="gap-2 text-muted-foreground hover:text-foreground"
						disabled={entries.length === 0}
						onClick={() => clear()}
					>
						<Trash2 className="size-4" aria-hidden />
						Clear
					</Button>
				</div>
				<ScrollArea className="min-h-0 w-full flex-1">
					<div className="px-5 py-3">
						{ordered.length === 0 ? (
							<p className="py-10 text-center text-sm text-muted-foreground">
								No activity yet.
							</p>
						) : (
							<ul className="flex flex-col">
								{ordered.map((entry) => (
									<LogRow key={entry.id} entry={entry} />
								))}
							</ul>
						)}
					</div>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}
