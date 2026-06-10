import { BookOpenCheck, Moon, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useListenEstimateStore } from "../listenEstimate/listenEstimateStore";
import {
	formatSleepRemaining,
	parseCustomSleepMinutes,
} from "./sleepTimerUtils";
import { useSleepTimerStore } from "./sleepTimerStore";

const PRESET_MINUTES = [15, 30, 45, 60] as const;

/** Live `hh:mm:ss` countdown for the active time-mode timer (null otherwise). */
function useSleepCountdown(): string | null {
	const mode = useSleepTimerStore((s) => s.mode);
	const endTimeMs = useSleepTimerStore((s) => s.endTimeMs);
	const [remainingMs, setRemainingMs] = useState(0);

	useEffect(() => {
		if (mode !== "time" || endTimeMs == null) {
			setRemainingMs(0);
			return;
		}
		const tick = () => setRemainingMs(Math.max(0, endTimeMs - Date.now()));
		tick();
		const id = window.setInterval(tick, 1000);
		return () => window.clearInterval(id);
	}, [mode, endTimeMs]);

	if (mode !== "time" || endTimeMs == null) return null;
	return formatSleepRemaining(remainingMs);
}

/**
 * Sleep timer entry point in the transport bar: a Moon button that opens a
 * dialog with presets, a custom duration, and a "stop after a chapter" mode
 * where any chapter at or after the current one can be picked. While active
 * the button shows the countdown (or "Until: <chapter>") and a small ×
 * cancels without opening the dialog.
 */
export function SleepTimerControl() {
	const mode = useSleepTimerStore((s) => s.mode);
	const targetChapterId = useSleepTimerStore((s) => s.targetChapterId);
	const startTimer = useSleepTimerStore((s) => s.startTimer);
	const startEndOfChapter = useSleepTimerStore((s) => s.startEndOfChapter);
	const clearTimer = useSleepTimerStore((s) => s.clearTimer);

	const chapters = useListenEstimateStore((s) => s.chapters);
	const activeChapterId = useListenEstimateStore((s) => s.activeChapterId);

	const [open, setOpen] = useState(false);
	const [customMinutes, setCustomMinutes] = useState("45");
	const [customError, setCustomError] = useState<string | null>(null);
	const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
		null,
	);

	// Earlier chapters are hidden: sleeping at a chapter already played makes
	// no sense. With no active chapter the full list stays selectable.
	const selectableChapters = useMemo(() => {
		const idx = activeChapterId
			? chapters.findIndex((c) => c.id === activeChapterId)
			: -1;
		return idx >= 0 ? chapters.slice(idx) : chapters;
	}, [chapters, activeChapterId]);
	const hasChapterList = selectableChapters.length > 0;

	const countdown = useSleepCountdown();
	const active = mode !== null;
	const targetChapterTitle =
		mode === "endOfChapter" && targetChapterId != null
			? (chapters.find((c) => c.id === targetChapterId)?.title ?? null)
			: null;
	const barLabel =
		mode === "endOfChapter"
			? targetChapterTitle != null
				? `Until: ${targetChapterTitle}`
				: "End of chapter"
			: (countdown ?? null);

	const applyMinutes = (minutes: number) => {
		startTimer(minutes);
		setOpen(false);
	};

	const submitCustom = () => {
		const minutes = parseCustomSleepMinutes(customMinutes);
		if (minutes == null) {
			setCustomError("Enter a whole number between 1 and 1440.");
			return;
		}
		applyMinutes(minutes);
	};

	const openDialog = () => {
		setCustomError(null);
		// Preselect the active sleep target when one is set and still ahead,
		// otherwise the current chapter.
		const preferred =
			mode === "endOfChapter" &&
			targetChapterId != null &&
			selectableChapters.some((c) => c.id === targetChapterId)
				? targetChapterId
				: activeChapterId != null &&
						selectableChapters.some((c) => c.id === activeChapterId)
					? activeChapterId
					: (selectableChapters[0]?.id ?? null);
		setSelectedChapterId(preferred);
		setOpen(true);
	};

	const submitChapter = () => {
		startEndOfChapter(hasChapterList ? selectedChapterId : null);
		setOpen(false);
	};

	const statusLabel =
		mode === "endOfChapter"
			? targetChapterTitle != null
				? `Pausing at the end of “${targetChapterTitle}”`
				: "Pausing at the end of this chapter"
			: countdown != null
				? `Pausing in ${countdown}`
				: null;

	return (
		<>
			<div className="flex shrink-0 items-center">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant={active ? "secondary" : "ghost"}
							size={active ? "sm" : "icon"}
							className={cn(
								active
									? "gap-1.5 rounded-r-none px-2.5 tabular-nums text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							aria-label={
								active ? `Sleep timer, ${barLabel}` : "Sleep timer"
							}
							onClick={openDialog}
						>
							<Moon className="size-5 shrink-0" aria-hidden />
							{active ? (
								<span className="max-w-[10rem] truncate text-xs font-medium">
									{barLabel}
								</span>
							) : null}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">
						{active
							? (statusLabel ?? "Sleep timer")
							: "Sleep timer — pause after a set time"}
					</TooltipContent>
				</Tooltip>
				{active ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								className="rounded-l-none border-l border-border/60 px-1.5 text-muted-foreground hover:text-foreground"
								aria-label="Cancel sleep timer"
								onClick={clearTimer}
							>
								<X className="size-3.5" aria-hidden />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="top">Cancel sleep timer</TooltipContent>
					</Tooltip>
				) : null}
			</div>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-[26rem]">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Moon className="size-4 text-muted-foreground" aria-hidden />
							Sleep timer
						</DialogTitle>
						<DialogDescription>
							Pause playback automatically when it's time to sleep.
						</DialogDescription>
					</DialogHeader>

					{active ? (
						<div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
							<div className="min-w-0">
								<p className="truncate text-sm font-medium">{statusLabel}</p>
								<p className="text-xs text-muted-foreground">
									Picking a new option replaces the current timer.
								</p>
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="shrink-0"
								onClick={clearTimer}
							>
								Cancel timer
							</Button>
						</div>
					) : null}

					<div className="rounded-lg border border-border bg-muted/20 p-4">
						<p className="text-sm font-medium">Stop after</p>
						<div className="mt-3 grid grid-cols-4 gap-2">
							{PRESET_MINUTES.map((m) => (
								<Button
									key={m}
									type="button"
									variant="outline"
									className="bg-transparent tabular-nums"
									onClick={() => applyMinutes(m)}
								>
									{m}m
								</Button>
							))}
						</div>
						<div className="mt-3 flex items-end gap-2">
							<div className="min-w-0 flex-1 space-y-1.5">
								<Label
									htmlFor="sleep-timer-minutes"
									className="text-xs text-muted-foreground"
								>
									Custom minutes
								</Label>
								<Input
									id="sleep-timer-minutes"
									type="number"
									min={1}
									max={1440}
									inputMode="numeric"
									value={customMinutes}
									onChange={(e) => {
										setCustomMinutes(e.target.value);
										setCustomError(null);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") submitCustom();
									}}
								/>
							</div>
							<Button type="button" onClick={submitCustom}>
								Start
							</Button>
						</div>
						{customError ? (
							<p className="mt-2 text-xs text-destructive">{customError}</p>
						) : null}
					</div>

					<div className="rounded-lg border border-border bg-muted/20 p-4">
						<p className="flex items-center gap-2 text-sm font-medium">
							<BookOpenCheck
								className="size-4 text-muted-foreground"
								aria-hidden
							/>
							Stop after a chapter
						</p>
						{hasChapterList ? (
							<>
								<p className="mt-1 text-xs text-muted-foreground">
									Pause when the selected chapter finishes playing.
								</p>
								<ScrollArea className="mt-3 h-44 rounded-md border border-border/60 bg-background/40">
									<div
										className="p-1"
										role="listbox"
										aria-label="Sleep after chapter"
									>
										{selectableChapters.map((c) => {
											const selected = selectedChapterId === c.id;
											return (
												<button
													key={c.id}
													type="button"
													role="option"
													aria-selected={selected}
													className={cn(
														"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
														selected
															? "bg-secondary text-foreground"
															: "text-muted-foreground hover:bg-accent hover:text-foreground",
													)}
													onClick={() => setSelectedChapterId(c.id)}
												>
													<span className="min-w-0 flex-1 truncate">
														{c.title}
													</span>
													{c.id === activeChapterId ? (
														<span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
															Current
														</span>
													) : null}
												</button>
											);
										})}
									</div>
								</ScrollArea>
								<Button
									type="button"
									className="mt-3 w-full"
									disabled={selectedChapterId == null}
									onClick={submitChapter}
								>
									Pause after selected chapter
								</Button>
							</>
						) : (
							<div className="mt-1 flex items-center justify-between gap-3">
								<p className="text-xs text-muted-foreground">
									Pause when the current chapter finishes playing.
								</p>
								<Button
									type="button"
									variant={mode === "endOfChapter" ? "secondary" : "outline"}
									size="sm"
									className="shrink-0"
									onClick={submitChapter}
								>
									{mode === "endOfChapter" ? "Active" : "Set"}
								</Button>
							</div>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
