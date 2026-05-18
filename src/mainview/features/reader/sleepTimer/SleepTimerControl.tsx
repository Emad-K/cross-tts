import { Moon, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	formatSleepRemaining,
	parseCustomSleepMinutes,
} from "./sleepTimerUtils";
import { useSleepTimerStore } from "./sleepTimerStore";

const PRESET_MINUTES = [10, 15, 20, 30, 45, 60] as const;

export function SleepTimerControl() {
	const endTimeMs = useSleepTimerStore((s) => s.endTimeMs);
	const startTimer = useSleepTimerStore((s) => s.startTimer);
	const clearTimer = useSleepTimerStore((s) => s.clearTimer);

	const [customOpen, setCustomOpen] = useState(false);
	const [customMinutes, setCustomMinutes] = useState("45");
	const [customError, setCustomError] = useState<string | null>(null);
	const [remainingMs, setRemainingMs] = useState(0);

	const active = endTimeMs != null;

	useEffect(() => {
		if (!active) {
			setRemainingMs(0);
			return;
		}
		const tick = () => {
			const left = endTimeMs - Date.now();
			if (left <= 0) {
				setRemainingMs(0);
				return;
			}
			setRemainingMs(left);
		};
		tick();
		const id = window.setInterval(tick, 1000);
		return () => window.clearInterval(id);
	}, [active, endTimeMs]);

	const applyMinutes = (minutes: number) => {
		startTimer(minutes);
	};

	const openCustom = () => {
		setCustomError(null);
		setCustomOpen(true);
	};

	const submitCustom = () => {
		const minutes = parseCustomSleepMinutes(customMinutes);
		if (minutes == null) {
			setCustomError("Enter a whole number between 1 and 1440.");
			return;
		}
		applyMinutes(minutes);
		setCustomOpen(false);
	};

	const remainingLabel = active ? formatSleepRemaining(remainingMs) : null;

	return (
		<>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant={active ? "secondary" : "ghost"}
								size={active ? "sm" : "icon"}
								className={cn(
									active
										? "gap-1.5 px-2.5 tabular-nums text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
								aria-label={
									active
										? `Sleep timer, ${remainingLabel} remaining`
										: "Sleep timer"
								}
							>
								<Moon className="size-5 shrink-0" aria-hidden />
								{active ? (
									<span className="text-xs font-medium">{remainingLabel}</span>
								) : null}
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="top">
						{active
							? `Sleep timer · ${remainingLabel} left`
							: "Sleep timer — pause after a set time"}
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="center" className="min-w-[10rem]">
					<DropdownMenuLabel className="flex items-center gap-2">
						<Timer className="size-4 opacity-70" aria-hidden />
						Sleep timer
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{PRESET_MINUTES.map((m) => (
						<DropdownMenuItem key={m} onClick={() => applyMinutes(m)}>
							{m} minutes
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={openCustom}>Custom…</DropdownMenuItem>
					{active ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive focus:text-destructive"
								onClick={clearTimer}
							>
								Clear timer
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={customOpen} onOpenChange={setCustomOpen}>
				<DialogContent className="sm:max-w-[22rem]">
					<DialogHeader>
						<DialogTitle>Custom sleep timer</DialogTitle>
						<DialogDescription>
							Pause playback after this many minutes if still playing.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 py-2">
						<Label htmlFor="sleep-timer-minutes">Minutes</Label>
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
						{customError ? (
							<p className="text-xs text-destructive">{customError}</p>
						) : null}
					</div>
					<DialogFooter className="gap-2 sm:gap-0">
						<Button
							type="button"
							variant="outline"
							onClick={() => setCustomOpen(false)}
						>
							Cancel
						</Button>
						<Button type="button" onClick={submitCustom}>
							Start
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
