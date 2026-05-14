import {
	ChevronDown,
	ChevronsDown,
	ChevronsUp,
	Download,
	Pause,
	RotateCcw,
	SkipBack,
	SkipForward,
	Volume2,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SPEEDS = ["0.75x", "1x", "1.25x", "1.5x", "2x"] as const;
const VOICES = ["Heart", "Samantha", "Alex", "Jamie"] as const;

export type PlaybackControlsProps = {
	className?: string;
};

/**
 * Media-style footer for TTS. Values are local UI state until the engine exists.
 */
export function PlaybackControls({ className }: PlaybackControlsProps) {
	const progressId = useId();
	const volumeId = useId();
	const [progress, setProgress] = useState([32]);
	const [volume, setVolume] = useState([80]);
	const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>("1x");
	const [voice, setVoice] = useState<(typeof VOICES)[number]>("Heart");

	const speedIndex = useMemo(() => {
		const i = SPEEDS.indexOf(speed);
		return i === -1 ? SPEEDS.indexOf("1x") : i;
	}, [speed]);

	const speedDown = () => {
		setSpeed(SPEEDS[Math.max(0, speedIndex - 1)]);
	};

	const speedUp = () => {
		setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, speedIndex + 1)]);
	};

	const resetSpeed = () => setSpeed("1x");

	const canSpeedDown = speedIndex > 0;
	const canSpeedUp = speedIndex < SPEEDS.length - 1;

	const elapsed = "0:47";
	const total = "2:24";

	return (
		<footer
			className={cn(
				"shrink-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
				className,
			)}
		>
			<div className="mx-auto max-w-6xl min-w-0 px-4 py-3 sm:py-4">
				<div className="mb-3 flex items-end justify-between text-[11px] tabular-nums text-muted-foreground sm:text-xs">
					<span id={`${progressId}-elapsed`}>{elapsed}</span>
					<span id={`${progressId}-total`}>{total}</span>
				</div>
				<div className="mb-4 sm:mb-5">
					<Slider
						aria-labelledby={`${progressId}-elapsed ${progressId}-total`}
						value={progress}
						max={100}
						step={1}
						onValueChange={setProgress}
						className="w-full"
					/>
				</div>

				<div className="grid w-full min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6">
					<div className="flex min-w-0 flex-wrap items-center justify-center gap-1 sm:gap-2 lg:justify-start">
						<Button type="button" variant="ghost" size="icon" aria-label="Skip back">
							<SkipBack className="size-5" />
						</Button>
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="size-12 rounded-full border-2 border-foreground/80 bg-transparent hover:bg-accent"
							aria-label="Pause"
						>
							<Pause className="size-5" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Skip forward"
						>
							<SkipForward className="size-5" />
						</Button>

						<div
							className="mx-1 hidden h-8 w-px shrink-0 bg-border sm:mx-2 sm:block"
							aria-hidden
						/>
						<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="inline-flex">
										<Button
											type="button"
											variant="outline"
											size="icon"
											className="size-9 border-border bg-transparent text-muted-foreground hover:text-foreground"
											disabled={!canSpeedDown}
											aria-label="Speed down"
											onClick={speedDown}
										>
											<ChevronsDown className="size-4" />
										</Button>
									</span>
								</TooltipTrigger>
								<TooltipContent side="top">Speed down</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="inline-flex">
										<Button
											type="button"
											variant="outline"
											size="icon"
											className="size-9 border-border bg-transparent text-muted-foreground hover:text-foreground"
											aria-label="Reset speed"
											onClick={resetSpeed}
										>
											<RotateCcw className="size-4" />
										</Button>
									</span>
								</TooltipTrigger>
								<TooltipContent side="top">Reset speed</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="inline-flex">
										<Button
											type="button"
											variant="outline"
											size="icon"
											className="size-9 border-border bg-transparent text-muted-foreground hover:text-foreground"
											disabled={!canSpeedUp}
											aria-label="Speed up"
											onClick={speedUp}
										>
											<ChevronsUp className="size-4" />
										</Button>
									</span>
								</TooltipTrigger>
								<TooltipContent side="top">Speed up</TooltipContent>
							</Tooltip>
						</div>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="gap-1 text-muted-foreground hover:text-foreground"
								>
									{speed}
									<ChevronDown className="size-4 opacity-70" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="center" className="min-w-[8rem]">
								<DropdownMenuRadioGroup
									value={speed}
									onValueChange={(v) => setSpeed(v as (typeof SPEEDS)[number])}
								>
									{SPEEDS.map((s) => (
										<DropdownMenuRadioItem key={s} value={s}>
											{s}
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>

						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Download"
							className="text-muted-foreground hover:text-foreground"
						>
							<Download className="size-5" />
						</Button>
					</div>

					<div className="flex shrink-0 flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-end">
						<div className="flex w-28 shrink-0 items-center gap-2 sm:w-32">
							<Volume2
								className="size-4 shrink-0 text-muted-foreground"
								aria-hidden
							/>
							<Slider
								aria-labelledby={volumeId}
								value={volume}
								max={100}
								step={1}
								onValueChange={setVolume}
								className="min-w-0 flex-1"
							/>
							<span id={volumeId} className="sr-only">
								Volume
							</span>
						</div>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="w-full shrink-0 justify-between gap-2 border-border bg-transparent sm:min-w-[8.5rem] sm:w-auto"
								>
									{voice}
									<ChevronDown className="size-4 opacity-70" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="min-w-[10rem]">
								{VOICES.map((v) => (
									<DropdownMenuItem key={v} onClick={() => setVoice(v)}>
										{v}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</div>
		</footer>
	);
}
