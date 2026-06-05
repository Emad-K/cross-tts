import {
	Cpu,
	Download,
	FolderCog,
	FolderOpen,
	Loader2,
	RotateCcw,
	Wand2,
	Zap,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
	chooseDataDirectory,
	relaunchApp,
	resetDataDirectory,
	revealDataDirectory,
} from "@/lib/desktopBridge";
import { cn } from "@/lib/utils";
import {
	downloadVoicesAndModel,
	getActiveDevice,
	resetKokoroEngine,
	useTtsStore,
} from "../tts";
import { maxCpuThreads, useAppSettingsStore } from "./appSettingsStore";
import { TtsRulesPanel } from "./TtsRulesPanel";

type SectionId = "storage" | "performance" | "rules";

const NAV: { id: SectionId; label: string; icon: typeof FolderCog }[] = [
	{ id: "storage", label: "Storage", icon: FolderCog },
	{ id: "performance", label: "Performance", icon: Zap },
	{ id: "rules", label: "Text & speech", icon: Wand2 },
];

export type SettingsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

function formatBytes(bytes: number): string {
	if (!bytes) return "0 MB";
	const mb = bytes / 1_048_576;
	if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
	if (mb >= 1) return `${mb.toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Shared right-pane shell: sticky header + scrollable body. */
function SectionPane({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12">
				<h2 className="text-base font-semibold leading-none">{title}</h2>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			<ScrollArea className="min-h-0 w-full flex-1">
				<div className="px-6 py-5">{children}</div>
			</ScrollArea>
		</div>
	);
}

function StoragePanel() {
	const config = useAppSettingsStore((s) => s.config);
	const refresh = useAppSettingsStore((s) => s.refresh);
	const voiceDownloadPhase = useTtsStore((s) => s.voiceDownloadPhase);
	const voiceDownloadProgress = useTtsStore((s) => s.voiceDownloadProgress);
	const voiceDownloadError = useTtsStore((s) => s.voiceDownloadError);
	const [pendingRestart, setPendingRestart] = useState(false);
	const [working, setWorking] = useState(false);

	const downloading = voiceDownloadPhase === "running";

	const onChangeFolder = async () => {
		setWorking(true);
		try {
			const updated = await chooseDataDirectory();
			if (updated) {
				useAppSettingsStore.getState().setConfig(updated);
				setPendingRestart(true);
			}
		} finally {
			setWorking(false);
		}
	};

	const onResetFolder = async () => {
		setWorking(true);
		try {
			const updated = await resetDataDirectory();
			if (updated) {
				useAppSettingsStore.getState().setConfig(updated);
				setPendingRestart(true);
			}
		} finally {
			setWorking(false);
		}
	};

	return (
		<SectionPane
			title="Storage location"
			description="Where voice models and your reading session are saved on this device."
		>
			<div className="rounded-md border border-border bg-background px-3 py-2">
				<div className="flex items-center justify-between gap-2">
					<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Data folder
					</span>
					{config?.isDefaultDataDir ? (
						<Badge
							variant="secondary"
							className="rounded-sm border border-border bg-muted px-1.5 py-0 text-[10px] font-normal"
						>
							Default
						</Badge>
					) : null}
				</div>
				<p
					className="mt-1 break-all font-mono text-xs text-foreground/90"
					title={config?.dataDir ?? ""}
				>
					{config?.dataDir ?? "—"}
				</p>
			</div>

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="gap-2 border-border bg-transparent"
					disabled={working}
					onClick={() => void onChangeFolder()}
				>
					<FolderOpen className="size-4" aria-hidden />
					Change…
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="gap-2 text-muted-foreground hover:text-foreground"
					onClick={() => void revealDataDirectory()}
				>
					Reveal in file manager
				</Button>
				{config && !config.isDefaultDataDir ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="gap-2 text-muted-foreground hover:text-foreground"
						disabled={working}
						onClick={() => void onResetFolder()}
					>
						<RotateCcw className="size-4" aria-hidden />
						Use default
					</Button>
				) : null}
			</div>

			<div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
				<p className="text-xs text-muted-foreground">
					{config?.modelsDownloaded
						? `Models downloaded · ${formatBytes(config.modelBytes)}`
						: "Models download automatically on first playback."}
				</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="shrink-0 gap-2 border-border bg-transparent"
					disabled={downloading}
					onClick={() =>
						void downloadVoicesAndModel().finally(() => void refresh())
					}
				>
					{downloading ? (
						<Loader2 className="size-4 animate-spin" aria-hidden />
					) : (
						<Download className="size-4" aria-hidden />
					)}
					{downloading
						? voiceDownloadProgress
							? `Voices ${voiceDownloadProgress.loaded}/${voiceDownloadProgress.total}`
							: "Downloading…"
						: "Download now"}
				</Button>
			</div>
			{voiceDownloadError ? (
				<p className="mt-2 text-xs text-destructive">{voiceDownloadError}</p>
			) : null}

			{pendingRestart ? (
				<div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
					<p className="text-xs text-amber-300">
						Restart to use the new folder. Existing models stay where they are.
					</p>
					<Button
						type="button"
						size="sm"
						className="shrink-0"
						onClick={() => void relaunchApp()}
					>
						Restart now
					</Button>
				</div>
			) : null}
		</SectionPane>
	);
}

function CpuThreadsControl() {
	const config = useAppSettingsStore((s) => s.config);
	const setCpuThreads = useAppSettingsStore((s) => s.setCpuThreads);
	const max = maxCpuThreads();
	const stored = config?.cpuThreads ?? 0;
	// `null` while not dragging → show the stored value; a number while dragging.
	const [draft, setDraft] = useState<number | null>(null);
	const shown = draft ?? stored;

	const commit = (value: number) => {
		setDraft(null);
		void setCpuThreads(value);
		// New thread count only applies on a fresh CPU load. If a CPU model is
		// loaded, drop it so the next play picks up the change; leave a GPU model
		// alone (the thread count doesn't affect it).
		if (getActiveDevice() !== "webgpu") resetKokoroEngine();
	};

	return (
		<div className="mt-3 rounded-lg border border-border bg-muted/20 p-4">
			<div className="flex items-center justify-between gap-4">
				<span className="flex items-center gap-2 text-sm font-medium">
					<Cpu className="size-4 text-muted-foreground" aria-hidden />
					CPU threads
				</span>
				<span className="text-xs font-medium tabular-nums text-muted-foreground">
					{shown === 0 ? `Auto (${max})` : shown}
				</span>
			</div>
			<Slider
				className="mt-4"
				aria-label="CPU threads"
				min={0}
				max={max}
				step={1}
				value={[Math.min(shown, max)]}
				onValueChange={(v) => setDraft(v[0] ?? 0)}
				onValueCommit={(v) => commit(v[0] ?? 0)}
			/>
			<div className="mt-2 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
				<span>Auto</span>
				<span>{max} (max)</span>
			</div>
			<p className="mt-3 text-xs text-muted-foreground">
				Threads used for CPU synthesis. Max is one less than your{" "}
				{max + 1} logical cores. Auto uses {max}. Only applies when running on
				the CPU.
			</p>
		</div>
	);
}

function PerformancePanel() {
	const gpuSwitchId = useId();
	const config = useAppSettingsStore((s) => s.config);
	const webgpuAvailable = useAppSettingsStore((s) => s.webgpuAvailable);
	const setWebgpuAvailable = useAppSettingsStore((s) => s.setWebgpuAvailable);
	const setGpuEnabled = useAppSettingsStore((s) => s.setGpuEnabled);
	const gpuEnabled = config?.gpuEnabled ?? false;

	useEffect(() => {
		if (webgpuAvailable !== null || typeof navigator === "undefined") return;
		void (async () => {
			try {
				const adapter = await navigator.gpu?.requestAdapter();
				setWebgpuAvailable(!!adapter);
			} catch {
				setWebgpuAvailable(false);
			}
		})();
	}, [webgpuAvailable, setWebgpuAvailable]);

	const onToggleGpu = async (next: boolean) => {
		await setGpuEnabled(next);
		// CPU and GPU use different model weights — drop the loaded model so the
		// next play reloads the right one.
		resetKokoroEngine();
	};

	return (
		<SectionPane
			title="Performance"
			description="GPU synthesis is faster but uses a separate, larger model. CPU works everywhere."
		>
			<div className="rounded-lg border border-border bg-muted/20 p-4">
				<label
					htmlFor={gpuSwitchId}
					className="flex cursor-pointer items-center justify-between gap-4"
				>
					<span className="flex items-center gap-2 text-sm font-medium">
						{gpuEnabled ? (
							<Zap className="size-4 text-amber-400" aria-hidden />
						) : (
							<Cpu className="size-4 text-muted-foreground" aria-hidden />
						)}
						<span>
							Use GPU acceleration
							<span className="ml-2 text-xs font-normal text-muted-foreground">
								{gpuEnabled ? "GPU" : "CPU"}
							</span>
						</span>
					</span>
					<Switch
						id={gpuSwitchId}
						checked={gpuEnabled}
						onCheckedChange={(v) => void onToggleGpu(v)}
					/>
				</label>
				<p className="mt-3 text-xs text-muted-foreground">
					{webgpuAvailable === false
						? "No compatible GPU (WebGPU) detected — playback will use the CPU even when this is on."
						: gpuEnabled
							? "The GPU model loads on the next playback. If the GPU is unavailable it falls back to CPU automatically."
							: "Switch on to synthesize with the GPU when a compatible one is available."}
				</p>
			</div>
			<CpuThreadsControl />
		</SectionPane>
	);
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
	const [section, setSection] = useState<SectionId>("storage");
	const hydrate = useAppSettingsStore((s) => s.hydrate);
	const refresh = useAppSettingsStore((s) => s.refresh);

	useEffect(() => {
		if (!open) return;
		void hydrate();
		void refresh();
	}, [open, hydrate, refresh]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				aria-describedby={undefined}
				className="flex h-[min(90vh,40rem)] max-h-[min(90vh,40rem)] w-full max-w-3xl gap-0 overflow-hidden p-0 [&>button]:z-10"
			>
				<DialogTitle className="sr-only">Settings</DialogTitle>
				{/* Left nav (Claude-desktop style). */}
				<nav className="flex w-48 shrink-0 flex-col border-r border-border bg-muted/20 p-3">
					<p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Settings
					</p>
					<ul className="flex flex-col gap-0.5">
						{NAV.map((item) => {
							const Icon = item.icon;
							const activeItem = section === item.id;
							return (
								<li key={item.id}>
									<button
										type="button"
										onClick={() => setSection(item.id)}
										aria-current={activeItem ? "page" : undefined}
										className={cn(
											"flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
											activeItem
												? "bg-muted font-medium text-foreground"
												: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
										)}
									>
										<Icon className="size-4 shrink-0" aria-hidden />
										{item.label}
									</button>
								</li>
							);
						})}
					</ul>
				</nav>

				{/* Right content pane. */}
				<div className="min-h-0 min-w-0 flex-1">
					{section === "storage" ? <StoragePanel /> : null}
					{section === "performance" ? <PerformancePanel /> : null}
					{section === "rules" ? (
						<TtsRulesPanel active={section === "rules"} />
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
