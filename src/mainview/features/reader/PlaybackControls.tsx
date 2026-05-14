import {
	ChevronDown,
	ChevronsDown,
	ChevronsUp,
	Download,
	Loader2,
	Pause,
	Play,
	RotateCcw,
	SkipBack,
	SkipForward,
	Volume2,
} from "lucide-react";
import { useId, useEffect, useMemo, useState } from "react";
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
import {
	downloadVoicesAndModel,
	seekProgressPercent,
	setVolumeLive,
	skipChunk,
	togglePlayPause,
	useTtsStore,
} from "./tts";
import { KOKORO_VOICE_IDS } from "./tts/kokoroVoices";

const SPEEDS = ["0.75x", "1x", "1.25x", "1.5x", "2x"] as const;

function speedLabelToNumber(label: (typeof SPEEDS)[number]): number {
	return Number.parseFloat(label.replace("x", ""));
}

export type PlaybackControlsProps = {
	className?: string;
};

/**
 * Media-style footer wired to Kokoro TTS and zustand playback state.
 */
export function PlaybackControls({ className }: PlaybackControlsProps) {
	const progressId = useId();
	const volumeId = useId();
	const [progress, setProgress] = useState([0]);
	const [isDraggingProgress, setIsDraggingProgress] = useState(false);

	const playback = useTtsStore((s) => s.playback);
	const progressPct = useTtsStore((s) => s.progressPct);
	const currentChunkIndex = useTtsStore((s) => s.currentChunkIndex);
	const volumePct = useTtsStore((s) => s.volumePct);
	const voice = useTtsStore((s) => s.voice);
	const voiceOptions = useTtsStore((s) => s.voiceOptions);
	const speedNum = useTtsStore((s) => s.speed);
	const chunks = useTtsStore((s) => s.chunks);
	const modelPhase = useTtsStore((s) => s.modelPhase);
	const modelError = useTtsStore((s) => s.modelError);
	const playbackError = useTtsStore((s) => s.playbackError);
	const voiceDownloadPhase = useTtsStore((s) => s.voiceDownloadPhase);
	const voiceDownloadProgress = useTtsStore((s) => s.voiceDownloadProgress);

	const speedLabel = useMemo(() => {
		let best: (typeof SPEEDS)[number] = "1x";
		let bestDiff = Infinity;
		for (const s of SPEEDS) {
			const d = Math.abs(speedLabelToNumber(s) - speedNum);
			if (d < bestDiff) {
				bestDiff = d;
				best = s;
			}
		}
		return best;
	}, [speedNum]);

	const speedIndex = useMemo(() => {
		const i = SPEEDS.indexOf(speedLabel);
		return i === -1 ? SPEEDS.indexOf("1x") : i;
	}, [speedLabel]);

	const setSpeed = useTtsStore((s) => s.setSpeed);
	const setVoice = useTtsStore((s) => s.setVoice);

	const menuVoices = useMemo(() => {
		if (voiceOptions.length > 0) return voiceOptions;
		return KOKORO_VOICE_IDS.map((id) => ({ id, label: id }));
	}, [voiceOptions]);

	useEffect(() => {
		if (!isDraggingProgress) {
			setProgress([Math.round(progressPct)]);
		}
	}, [progressPct, isDraggingProgress]);

	const speedDown = () => {
		const next = SPEEDS[Math.max(0, speedIndex - 1)];
		setSpeed(speedLabelToNumber(next));
	};

	const speedUp = () => {
		setSpeed(
			speedLabelToNumber(SPEEDS[Math.min(SPEEDS.length - 1, speedIndex + 1)]),
		);
	};

	const resetSpeed = () => setSpeed(1);

	const canSpeedDown = speedIndex > 0;
	const canSpeedUp = speedIndex < SPEEDS.length - 1;

	const elapsedLabel =
		chunks.length === 0
			? "Chunk —"
			: `Chunk ${Math.min(chunks.length, currentChunkIndex + 1)}`;
	const totalLabel = chunks.length === 0 ? "of —" : `of ${chunks.length}`;

	const displayProgress =
		isDraggingProgress ? progress[0]! : Math.round(progressPct);

	const busyDownloading = voiceDownloadPhase === "running";
	const canPlay = chunks.length > 0 && modelPhase !== "error";
	const isModelLoading = playback === "loading_model";
	const isSynthesizingChunk = playback === "buffering";
	const isAudioPlaying = playback === "playing";

	return (
		<footer
			className={cn(
				"shrink-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
				className,
			)}
		>
			<div className="mx-auto max-w-6xl min-w-0 px-4 py-3 sm:py-4">
				{(modelError || playbackError) && (
					<p className="mb-2 text-xs text-destructive">
						{playbackError ?? modelError}
					</p>
				)}
				<div className="mb-3 flex items-end justify-between text-[11px] tabular-nums text-muted-foreground sm:text-xs">
					<span id={`${progressId}-elapsed`}>{elapsedLabel}</span>
					<span id={`${progressId}-total`}>{totalLabel}</span>
				</div>
				<div className="mb-4 sm:mb-5">
					<Slider
						aria-labelledby={`${progressId}-elapsed ${progressId}-total`}
						value={[displayProgress]}
						max={100}
						step={1}
						disabled={chunks.length === 0}
						onPointerDown={() => setIsDraggingProgress(true)}
						onValueChange={(v) => setProgress(v)}
						onValueCommit={(v) => {
							setIsDraggingProgress(false);
							seekProgressPercent(v[0] ?? 0);
						}}
						className="w-full"
					/>
				</div>

				<div className="grid w-full min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6">
					<div className="flex min-w-0 flex-wrap items-center justify-center gap-1 sm:gap-2 lg:justify-start">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Skip back"
							disabled={chunks.length === 0}
							onClick={() => skipChunk(-1)}
						>
							<SkipBack className="size-5" />
						</Button>
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="size-12 rounded-full border-2 border-foreground/80 bg-transparent hover:bg-accent"
							aria-label={
								isAudioPlaying
									? "Pause"
									: isSynthesizingChunk
										? "Pause while synthesizing"
										: "Play"
							}
							disabled={!canPlay || isModelLoading}
							onClick={() => void togglePlayPause()}
						>
							{isModelLoading || isSynthesizingChunk ? (
								<Loader2 className="size-5 animate-spin" />
							) : isAudioPlaying ? (
								<Pause className="size-5" />
							) : (
								<Play className="size-5" />
							)}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Skip forward"
							disabled={chunks.length === 0}
							onClick={() => skipChunk(1)}
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
									{speedLabel}
									<ChevronDown className="size-4 opacity-70" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="center" className="min-w-[8rem]">
								<DropdownMenuRadioGroup
									value={speedLabel}
									onValueChange={(v) =>
										setSpeed(speedLabelToNumber(v as (typeof SPEEDS)[number]))
									}
								>
									{SPEEDS.map((s) => (
										<DropdownMenuRadioItem key={s} value={s}>
											{s}
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>

						<Tooltip>
							<TooltipTrigger asChild>
								<span className="inline-flex">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label="Download Kokoro model and all voice weights"
										className="text-muted-foreground hover:text-foreground"
										disabled={busyDownloading}
										onClick={() => void downloadVoicesAndModel()}
									>
										{busyDownloading ? (
											<Loader2 className="size-5 animate-spin" />
										) : (
											<Download className="size-5" />
										)}
									</Button>
								</span>
							</TooltipTrigger>
							<TooltipContent side="top" className="max-w-xs">
								{voiceDownloadProgress
									? `Voices ${voiceDownloadProgress.loaded} / ${voiceDownloadProgress.total}`
									: "Download the ONNX model (first play also fetches it) and prefetch every voice .bin into the browser cache."}
							</TooltipContent>
						</Tooltip>
					</div>

					<div className="flex shrink-0 flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-end">
						<div className="flex w-28 shrink-0 items-center gap-2 sm:w-32">
							<Volume2
								className="size-4 shrink-0 text-muted-foreground"
								aria-hidden
							/>
							<Slider
								aria-labelledby={volumeId}
								value={[volumePct]}
								max={100}
								step={1}
								onValueChange={(v) => setVolumeLive(v[0] ?? 80)}
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
									className="w-full shrink-0 justify-between gap-2 border-border bg-transparent sm:min-w-[10rem] sm:w-auto"
								>
									{menuVoices.find((o) => o.id === voice)?.label ?? voice}
									<ChevronDown className="size-4 opacity-70" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								className="max-h-72 min-w-[12rem] overflow-y-auto"
							>
								{menuVoices.map((o) => (
									<DropdownMenuItem
										key={o.id}
										onClick={() => setVoice(o.id)}
									>
										{o.label}
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
