import {
	AudioLines,
	CheckCircle2,
	FolderOpen,
	Pause,
	Play,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AudioFormat } from "@shared/audiobook";
import type { ReaderChapter } from "@shared/readerTypes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { chooseExportFolder, revealPath } from "@/lib/desktopBridge";
import { useTtsStore } from "../tts";
import {
	cancelExport,
	isExportActive,
	pauseExport,
	resetExport,
	resumeExport,
	startExport,
	useExportStore,
} from "./exportEngine";
import { canExportM4b } from "./singleFileEncode";

export type AudiobookExportDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	filePath: string;
	bookTitle?: string;
	chapters: ReaderChapter[];
};

/** What the user actually decides: one audiobook, or a file per chapter. */
type Packaging = "single" | "perChapter";

const PACKAGING_OPTIONS: {
	id: Packaging;
	title: string;
	desc: string;
	recommended?: boolean;
}[] = [
	{
		id: "single",
		title: "One audiobook file",
		desc: "Plays in audiobook apps, remembers your place; chapters become markers.",
		recommended: true,
	},
	{
		id: "perChapter",
		title: "One file per chapter",
		desc: "Separate tracks — good for music players.",
	},
];

/** Formats offered per packaging choice (the first is the default). */
const FORMATS_FOR: Record<
	Packaging,
	{ id: AudioFormat; label: string }[]
> = {
	single: [
		{ id: "m4b", label: "M4B — audiobook (recommended)" },
		{ id: "mp3", label: "MP3 — one combined file" },
	],
	perChapter: [
		{ id: "mp3", label: "MP3 — smaller files" },
		{ id: "wav", label: "WAV — lossless" },
	],
};

function formatEta(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds)) return "—";
	const s = Math.max(0, Math.round(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
	if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
	return `${sec}s`;
}

export function AudiobookExportDialog({
	open,
	onOpenChange,
	filePath,
	bookTitle,
	chapters,
}: AudiobookExportDialogProps) {
	const phase = useExportStore((s) => s.phase);
	const doneChunks = useExportStore((s) => s.doneChunks);
	const totalChunks = useExportStore((s) => s.totalChunks);
	const totalChapters = useExportStore((s) => s.totalChapters);
	const currentChapterIndex = useExportStore((s) => s.currentChapterIndex);
	const currentChapterTitle = useExportStore((s) => s.currentChapterTitle);
	const etaSeconds = useExportStore((s) => s.etaSeconds);
	const filesWritten = useExportStore((s) => s.filesWritten);
	const skippedChapters = useExportStore((s) => s.skippedChapters);
	const outputDir = useExportStore((s) => s.outputDir);
	const error = useExportStore((s) => s.error);

	const voice = useTtsStore((s) => s.voice);
	const speed = useTtsStore((s) => s.speed);

	const [entire, setEntire] = useState(true);
	const [fromId, setFromId] = useState(chapters[0]?.id ?? "");
	const [toId, setToId] = useState(chapters[chapters.length - 1]?.id ?? "");
	const [packaging, setPackaging] = useState<Packaging>("single");
	const [format, setFormat] = useState<AudioFormat>("m4b");
	const [dir, setDir] = useState<string | null>(null);
	const [aacOk, setAacOk] = useState<boolean | null>(null);

	const active = phase === "preparing" || phase === "running" || phase === "paused";
	const isM4b = format === "m4b";

	// Switching packaging resets the format to that mode's default so an invalid
	// pair (e.g. M4B + per-chapter) can never be selected.
	const choosePackaging = (next: Packaging) => {
		setPackaging(next);
		setFormat(FORMATS_FOR[next][0]!.id);
	};

	// How many output files the current choices produce — shown so the outcome
	// is concrete before starting.
	const selectedCount = (() => {
		if (entire) return chapters.length;
		const fi = chapters.findIndex((c) => c.id === fromId);
		const ti = chapters.findIndex((c) => c.id === toId);
		if (fi < 0 || ti < 0) return 0;
		return Math.abs(ti - fi) + 1;
	})();
	const fileCount = packaging === "single" ? 1 : selectedCount;

	useEffect(() => {
		// Reset a finished/idle run when the dialog is reopened fresh.
		if (open && !isExportActive() && phase !== "idle") resetExport();
	}, [open, phase]);

	useEffect(() => {
		// Probe AAC encode support once, to tell the user when M4B will fall
		// back to a single MP3 with chapters.
		if (open && aacOk === null) void canExportM4b().then(setAacOk);
	}, [open, aacOk]);

	const onStart = () => {
		let selected = chapters;
		if (!entire) {
			const fi = chapters.findIndex((c) => c.id === fromId);
			const ti = chapters.findIndex((c) => c.id === toId);
			const a = Math.max(0, Math.min(fi, ti));
			const b = Math.max(fi, ti);
			selected = chapters.slice(a, b + 1);
		}
		if (!dir || selected.length === 0) return;
		// M4B is inherently a single file; MP3 needs the combine flag to merge.
		const combine = packaging === "single" && format !== "m4b";
		void startExport({
			filePath,
			chapters: selected.map((c) => ({ id: c.id, title: c.title })),
			format,
			dir,
			voice,
			speed,
			combine,
			bookTitle,
		});
	};

	const pct =
		totalChunks > 0 ? Math.min(100, Math.round((doneChunks / totalChunks) * 100)) : 0;

	const handleOpenChange = (next: boolean) => {
		// Don't let the dialog close mid-run; the user must cancel first.
		if (!next && active) return;
		onOpenChange(next);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				aria-describedby={undefined}
				className="w-full max-w-lg gap-0 overflow-hidden p-0"
				onInteractOutside={(e) => active && e.preventDefault()}
				onEscapeKeyDown={(e) => active && e.preventDefault()}
			>
				<div className="flex items-center gap-2.5 border-b border-border px-6 py-4">
					<AudioLines className="size-5 text-primary" aria-hidden />
					<DialogTitle className="text-base font-semibold">
						Create audiobook
					</DialogTitle>
				</div>

				<div className="px-6 py-5">
					{phase === "idle" ? (
						<div className="space-y-4">
							<div className="flex items-center justify-between gap-4">
								<div>
									<p className="text-sm font-medium">Entire book</p>
									<p className="text-xs text-muted-foreground">
										All {chapters.length} chapters.
									</p>
								</div>
								<Switch checked={entire} onCheckedChange={setEntire} />
							</div>

							{!entire ? (
								<div className="grid grid-cols-2 gap-3">
									<div>
										<p className="mb-1.5 text-xs font-medium text-muted-foreground">
											From chapter
										</p>
										<Select value={fromId} onValueChange={setFromId}>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{chapters.map((c) => (
													<SelectItem key={c.id} value={c.id}>
														{c.title}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<div>
										<p className="mb-1.5 text-xs font-medium text-muted-foreground">
											To chapter
										</p>
										<Select value={toId} onValueChange={setToId}>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{chapters.map((c) => (
													<SelectItem key={c.id} value={c.id}>
														{c.title}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>
							) : null}

							<div>
								<p className="mb-1.5 text-xs font-medium text-muted-foreground">
									What do you want?
								</p>
								<div className="grid grid-cols-1 gap-2">
									{PACKAGING_OPTIONS.map((opt) => {
										const selected = packaging === opt.id;
										return (
											<button
												key={opt.id}
												type="button"
												aria-pressed={selected}
												onClick={() => choosePackaging(opt.id)}
												className={cn(
													"flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
													selected
														? "border-primary bg-primary/5 ring-1 ring-primary"
														: "border-border hover:bg-accent",
												)}
											>
												<span
													className={cn(
														"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
														selected
															? "border-primary"
															: "border-muted-foreground/40",
													)}
													aria-hidden
												>
													{selected ? (
														<span className="size-2 rounded-full bg-primary" />
													) : null}
												</span>
												<span className="min-w-0">
													<span className="flex items-center gap-2 text-sm font-medium">
														{opt.title}
														{opt.recommended ? (
															<span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
																Recommended
															</span>
														) : null}
													</span>
													<span className="mt-0.5 block text-xs text-muted-foreground">
														{opt.desc}
													</span>
												</span>
											</button>
										);
									})}
								</div>
							</div>

							<div>
								<p className="mb-1.5 text-xs font-medium text-muted-foreground">
									Format
								</p>
								<Select
									value={format}
									onValueChange={(v) => setFormat(v as AudioFormat)}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{FORMATS_FOR[packaging].map((f) => (
											<SelectItem key={f.id} value={f.id}>
												{f.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="mt-1.5 text-xs text-muted-foreground">
									{fileCount > 0
										? `Creates ${fileCount} file${fileCount === 1 ? "" : "s"}.`
										: "Select a chapter range."}
									{isM4b
										? " Chapter markers and the book cover are embedded. Pause works, but a cancelled M4B export can’t be resumed later."
										: null}
									{isM4b && aacOk === false
										? " AAC isn’t available on this device, so the book will be saved as a single MP3 with chapter markers instead."
										: null}
								</p>
							</div>

							<div>
								<p className="mb-1.5 text-xs font-medium text-muted-foreground">
									Save to
								</p>
								<div className="flex items-center gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="gap-2 border-border bg-transparent"
										onClick={() =>
											void chooseExportFolder().then((d) => d && setDir(d))
										}
									>
										<FolderOpen className="size-4" aria-hidden />
										Choose folder…
									</Button>
									<span
										className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
										title={dir ?? ""}
									>
										{dir ?? "No folder chosen"}
									</span>
								</div>
							</div>

							<div className="flex justify-end gap-2 pt-2">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => onOpenChange(false)}
								>
									Cancel
								</Button>
								<Button
									type="button"
									size="sm"
									className="gap-2"
									disabled={!dir}
									onClick={onStart}
								>
									<AudioLines className="size-4" aria-hidden />
									Start
								</Button>
							</div>
						</div>
					) : null}

					{active ? (
						<div className="space-y-4">
							<div className="flex items-center justify-between text-sm">
								<span className="font-medium">
									{phase === "preparing"
										? "Preparing…"
										: `Chapter ${currentChapterIndex + 1} of ${totalChapters}`}
								</span>
								<span className="tabular-nums text-muted-foreground">{pct}%</span>
							</div>
							<Progress value={phase === "preparing" ? 0 : pct} />
							<p className="truncate text-xs text-muted-foreground" title={currentChapterTitle}>
								{currentChapterTitle || "…"}
							</p>
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>
									{doneChunks}/{totalChunks} segments
								</span>
								<span>
									{phase === "paused"
										? "Paused"
										: `~${formatEta(etaSeconds)} left`}
								</span>
							</div>
							{skippedChapters > 0 ? (
								<p className="text-xs text-muted-foreground">
									Resumed — skipped {skippedChapters} already-exported{" "}
									{skippedChapters === 1 ? "chapter" : "chapters"}.
								</p>
							) : null}
							<div className="flex justify-end gap-2 pt-1">
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="gap-2 border-border bg-transparent"
									onClick={() =>
										phase === "paused" ? resumeExport() : pauseExport()
									}
									disabled={phase === "preparing"}
								>
									{phase === "paused" ? (
										<Play className="size-4" aria-hidden />
									) : (
										<Pause className="size-4" aria-hidden />
									)}
									{phase === "paused" ? "Resume" : "Pause"}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="gap-2 text-destructive hover:text-destructive"
									onClick={() => cancelExport()}
								>
									<X className="size-4" aria-hidden />
									Cancel
								</Button>
							</div>
						</div>
					) : null}

					{phase === "done" || phase === "cancelled" ? (
						<div className="space-y-4">
							<div className="flex items-center gap-2.5">
								<CheckCircle2 className="size-5 text-emerald-500" aria-hidden />
								<p className="text-sm font-medium">
									{phase === "done"
										? `Done — ${filesWritten} file${filesWritten === 1 ? "" : "s"} created.`
										: `Cancelled — ${filesWritten} file${filesWritten === 1 ? "" : "s"} saved.`}
								</p>
							</div>
							{outputDir ? (
								<p
									className="truncate font-mono text-xs text-muted-foreground"
									title={outputDir}
								>
									{outputDir}
								</p>
							) : null}
							<div className="flex justify-end gap-2">
								{outputDir ? (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="gap-2 border-border bg-transparent"
										onClick={() => void revealPath(outputDir)}
									>
										<FolderOpen className="size-4" aria-hidden />
										Open folder
									</Button>
								) : null}
								<Button
									type="button"
									size="sm"
									onClick={() => {
										resetExport();
										onOpenChange(false);
									}}
								>
									Done
								</Button>
							</div>
						</div>
					) : null}

					{phase === "error" ? (
						<div className="space-y-4">
							<p className="text-sm text-destructive">
								{error ?? "Export failed."}
							</p>
							<div className="flex justify-end gap-2">
								<Button
									type="button"
									size="sm"
									onClick={() => {
										resetExport();
									}}
								>
									Back
								</Button>
							</div>
						</div>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
