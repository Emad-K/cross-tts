import {
	AudioLines,
	CheckCircle2,
	Cpu,
	Download,
	FolderCog,
	FolderOpen,
	FolderPlus,
	Keyboard,
	Loader2,
	Palette,
	RefreshCw,
	RotateCcw,
	Wand2,
	X,
	Zap,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { GpuPowerPreference } from "@shared/appConfig";
import {
	MODEL_KINDS,
	MODEL_LABEL,
	type ModelKind,
	type ModelStatusMap,
} from "@shared/modelAssets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
	addWatchedFolder,
	checkForUpdates,
	chooseDataDirectory,
	downloadModel,
	getGpuInfo,
	getModelStatus,
	isDesktopApp,
	quitAndInstallUpdate,
	relaunchApp,
	removeWatchedFolder,
	resetDataDirectory,
	revealDataDirectory,
	subscribeToModelProgress,
} from "@/lib/desktopBridge";
import type { UpdateStatus } from "@shared/updateStatus";
import { cn } from "@/lib/utils";
import {
	coerceEngineVoice,
	ensureTtsLoaded,
	getActiveDevice,
	getTtsEngine,
	MAX_SENTENCE_PAUSE_MS,
	resetTtsEngine,
	TTS_ENGINES,
	useTtsStore,
} from "../tts";
import {
	SUPERTONIC_DEFAULT_STEPS,
	SUPERTONIC_MAX_STEPS,
	SUPERTONIC_MIN_STEPS,
} from "../tts/supertonicModel";
import type { TtsEngine } from "../tts/ttsEngineTypes";
import { AppearancePanel } from "./AppearancePanel";
import { maxCpuThreads, useAppSettingsStore } from "./appSettingsStore";
import { useUpdateStore } from "./updateStore";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { TtsRulesPanel } from "./TtsRulesPanel";

type SectionId =
	| "appearance"
	| "playback"
	| "storage"
	| "performance"
	| "shortcuts"
	| "updates"
	| "rules";

const NAV: { id: SectionId; label: string; icon: typeof FolderCog }[] = [
	{ id: "appearance", label: "Appearance", icon: Palette },
	{ id: "playback", label: "Playback", icon: AudioLines },
	{ id: "storage", label: "Storage", icon: FolderCog },
	{ id: "performance", label: "Performance", icon: Zap },
	{ id: "shortcuts", label: "Shortcuts", icon: Keyboard },
	{ id: "updates", label: "Updates", icon: RefreshCw },
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

function ModelRow({
	kind,
	present,
	downloading,
	pct,
	bytes,
	onDownload,
}: {
	kind: ModelKind;
	present: boolean;
	downloading: boolean;
	pct: number;
	bytes: number;
	onDownload: () => void;
}) {
	const Icon = kind === "gpu" ? Zap : Cpu;
	return (
		<div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
			<Icon
				className={cn(
					"size-4 shrink-0",
					kind === "gpu" ? "text-amber-400" : "text-muted-foreground",
				)}
				aria-hidden
			/>
			<div className="min-w-0 flex-1">
				<div className="flex items-center justify-between gap-2">
					<span className="text-sm font-medium">{MODEL_LABEL[kind]}</span>
					<span className="text-[11px] tabular-nums text-muted-foreground">
						{present
							? formatBytes(bytes)
							: downloading
								? `${pct}%`
								: "Not downloaded"}
					</span>
				</div>
				<Progress value={pct} className="mt-2 h-1.5" />
			</div>
			{present ? (
				<CheckCircle2
					className="size-5 shrink-0 text-emerald-500"
					aria-label="Downloaded"
				/>
			) : downloading ? (
				<Loader2
					className="size-5 shrink-0 animate-spin text-muted-foreground"
					aria-hidden
				/>
			) : (
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-8 shrink-0 border-border bg-transparent"
					aria-label={`Download ${MODEL_LABEL[kind]}`}
					onClick={onDownload}
				>
					<Download className="size-4" aria-hidden />
				</Button>
			)}
		</div>
	);
}

function ModelsSection() {
	const [status, setStatus] = useState<ModelStatusMap | null>(null);
	const [progress, setProgress] = useState<
		Partial<Record<ModelKind, { loaded: number; total: number }>>
	>({});
	const [busy, setBusy] = useState<Partial<Record<ModelKind, boolean>>>({});

	useEffect(() => {
		let cancelled = false;
		void getModelStatus().then((s) => {
			if (!cancelled && s) setStatus(s);
		});
		const unsub = subscribeToModelProgress((p) => {
			if (p.done) {
				setProgress((prev) => {
					const next = { ...prev };
					delete next[p.kind];
					return next;
				});
				void getModelStatus().then((s) => {
					if (s) setStatus(s);
				});
				return;
			}
			setProgress((prev) => ({
				...prev,
				[p.kind]: { loaded: p.loaded, total: p.total },
			}));
		});
		return () => {
			cancelled = true;
			unsub();
		};
	}, []);

	const onDownload = (kind: ModelKind) => {
		setBusy((b) => ({ ...b, [kind]: true }));
		void downloadModel(kind)
			.then((s) => {
				if (s) setStatus(s);
			})
			.finally(() => setBusy((b) => ({ ...b, [kind]: false })));
	};

	return (
		<div className="space-y-2">
			<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Voice models
			</p>
			{MODEL_KINDS.map((kind) => {
				const present = status?.[kind].present ?? false;
				const prog = progress[kind];
				const downloading = (busy[kind] ?? false) || Boolean(prog);
				const pct = present
					? 100
					: prog && prog.total > 0
						? Math.min(100, Math.round((prog.loaded / prog.total) * 100))
						: prog
							? 5
							: 0;
				return (
					<ModelRow
						key={kind}
						kind={kind}
						present={present}
						downloading={downloading}
						pct={pct}
						bytes={status?.[kind].bytes ?? 0}
						onDownload={() => onDownload(kind)}
					/>
				);
			})}
			<p className="text-[11px] text-muted-foreground">
				Models download automatically on first playback; download here to use
				them offline. CPU and GPU use different weights.
			</p>
		</div>
	);
}

function WatchedFoldersSection() {
	const config = useAppSettingsStore((s) => s.config);
	const [working, setWorking] = useState(false);
	const folders = config?.watchedFolders ?? [];

	const onAdd = async () => {
		setWorking(true);
		try {
			const updated = await addWatchedFolder();
			if (updated) useAppSettingsStore.getState().setConfig(updated);
		} finally {
			setWorking(false);
		}
	};

	const onRemove = async (dir: string) => {
		const updated = await removeWatchedFolder(dir);
		if (updated) useAppSettingsStore.getState().setConfig(updated);
	};

	return (
		<div className="space-y-2">
			<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Watched folders
			</p>
			{folders.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					No folders are being watched.
				</p>
			) : (
				<ul className="space-y-1.5">
					{folders.map((dir) => (
						<li
							key={dir}
							className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5"
						>
							<FolderOpen
								className="size-4 shrink-0 text-muted-foreground"
								aria-hidden
							/>
							<span
								className="min-w-0 flex-1 break-all font-mono text-xs text-foreground/90"
								title={dir}
							>
								{dir}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
								aria-label={`Stop watching ${dir}`}
								onClick={() => void onRemove(dir)}
							>
								<X className="size-4" aria-hidden />
							</Button>
						</li>
					))}
				</ul>
			)}
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="gap-2 border-border bg-transparent"
				disabled={working}
				onClick={() => void onAdd()}
			>
				<FolderPlus className="size-4" aria-hidden />
				Add folder…
			</Button>
			<p className="text-[11px] text-muted-foreground">
				New .epub and .txt files in these folders (and their direct
				subfolders) are added to your library automatically.
			</p>
		</div>
	);
}

function StoragePanel() {
	const config = useAppSettingsStore((s) => s.config);
	const [pendingRestart, setPendingRestart] = useState(false);
	const [working, setWorking] = useState(false);

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

			<div className="mt-4 border-t border-border/60 pt-4">
				<WatchedFoldersSection />
			</div>

			<div className="mt-4 border-t border-border/60 pt-4">
				<ModelsSection />
			</div>

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
		if (getActiveDevice() !== "webgpu") resetTtsEngine();
	};

	return (
		<div className="mt-3 rounded-lg border border-border bg-muted/20 p-4">
			<div className="flex items-center justify-between gap-4">
				<span className="flex items-center gap-2 text-sm font-medium">
					<Cpu className="size-4 text-muted-foreground" aria-hidden />
					CPU threads
				</span>
				<span className="text-xs font-medium tabular-nums text-muted-foreground">
					{shown === 0 ? "Auto" : shown}
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
				Threads used for CPU synthesis; Auto picks a sensible count for the
				active engine. Max is one less than your {max + 1} logical cores. Only
				applies when running on the CPU.
			</p>
		</div>
	);
}

function CudaControl() {
	const switchId = useId();
	const config = useAppSettingsStore((s) => s.config);
	const setCudaEnabled = useAppSettingsStore((s) => s.setCudaEnabled);
	if (!config?.cudaSupported) return null;
	const onToggle = async (next: boolean) => {
		await setCudaEnabled(next);
		// The native engine picks its execution provider when it loads.
		if (getActiveDevice() !== "webgpu") resetTtsEngine();
	};
	return (
		<div className="mt-3 rounded-lg border border-border bg-muted/20 p-4">
			<label
				htmlFor={switchId}
				className="flex cursor-pointer items-center justify-between gap-4"
			>
				<span className="text-sm font-medium">
					Use NVIDIA GPU (CUDA) for native engine
				</span>
				<Switch
					id={switchId}
					checked={config.cudaEnabled}
					onCheckedChange={(v) => void onToggle(v)}
				/>
			</label>
			<p className="mt-3 text-xs text-muted-foreground">
				Experimental. Needs an NVIDIA GPU with CUDA 12 and cuDNN 9 installed,
				plus ONNX Runtime&apos;s CUDA provider libraries, which this app does
				not ship. When any of that is missing the native engine logs why and
				keeps using the CPU.
			</p>
		</div>
	);
}

function capitalize(s: string): string {
	return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function adapterName(info: GPUAdapterInfo | undefined): string | undefined {
	if (!info) return undefined;
	if (info.description) return info.description;
	const vendor = info.vendor ? capitalize(info.vendor) : "";
	const arch = info.architecture ?? "";
	const label = [vendor, arch].filter(Boolean).join(" ");
	return label || undefined;
}

function GpuPreferenceControl() {
	const config = useAppSettingsStore((s) => s.config);
	const setGpuPower = useAppSettingsStore((s) => s.setGpuPower);
	const power = config?.gpuPower ?? "auto";
	const [probe, setProbe] = useState<{
		high?: string;
		low?: string;
		distinct: boolean;
	}>({ distinct: false });
	const [detected, setDetected] = useState<{
		activeRenderer: string;
		gpus: string[];
	}>({ activeRenderer: "", gpus: [] });

	useEffect(() => {
		let cancelled = false;
		void getGpuInfo().then((info) => {
			if (!cancelled) setDetected(info);
		});
		if (typeof navigator !== "undefined" && navigator.gpu) {
			void (async () => {
				const one = async (p: GPUPowerPreference) => {
					try {
						const a = await navigator.gpu?.requestAdapter({
							powerPreference: p,
						});
						return adapterName(a?.info);
					} catch {
						return undefined;
					}
				};
				const [high, low] = await Promise.all([
					one("high-performance"),
					one("low-power"),
				]);
				if (!cancelled) {
					setProbe({
						high,
						low,
						distinct: Boolean(high && low && high !== low),
					});
				}
			})();
		}
		return () => {
			cancelled = true;
		};
	}, []);

	const onChange = (next: GpuPowerPreference) => {
		void setGpuPower(next);
		// Reload only if a GPU model is live; the new adapter applies on reload.
		if (getActiveDevice() === "webgpu") resetTtsEngine();
	};

	// Label the two WebGPU-addressable adapters with their real names.
	const options: { id: GpuPowerPreference; label: string }[] = [
		{ id: "auto", label: "Auto (recommended)" },
		{
			id: "high-performance",
			label: probe.high ?? detected.gpus[0] ?? "High-performance GPU",
		},
		{ id: "low-power", label: probe.low ?? "Power-saving GPU" },
	];

	return (
		<div className="mt-3 rounded-lg border border-border bg-muted/20 p-4">
			<div className="mb-3 text-sm font-medium">Preferred GPU</div>
			<Select
				value={power}
				onValueChange={(v) => onChange(v as GpuPowerPreference)}
			>
				<SelectTrigger className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((opt) => (
						<SelectItem key={opt.id} value={opt.id}>
							{opt.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{detected.gpus.length > 0 ? (
				<p className="mt-3 break-words text-xs text-muted-foreground">
					Detected: {detected.gpus.join(", ")}
				</p>
			) : null}
			<p className="mt-1.5 text-xs text-muted-foreground">
				WebGPU can only target the high-performance (dedicated) or low-power
				(integrated) GPU — it can't pick a specific one by name, so on machines
				with 3+ GPUs the extra cards aren't individually selectable.
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
		resetTtsEngine();
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
			{gpuEnabled && webgpuAvailable !== false ? <GpuPreferenceControl /> : null}
			<CpuThreadsControl />
			<CudaControl />
		</SectionPane>
	);
}

function updateStatusLabel(status: UpdateStatus): string | null {
	switch (status.state) {
		case "checking":
			return "Checking for updates…";
		case "downloading":
			return status.version
				? `Downloading ${status.version}…`
				: "Downloading update…";
		case "ready":
			return status.version
				? `${status.version} is ready — restart to update.`
				: "An update is ready — restart to update.";
		case "up-to-date":
			return "You're on the latest version.";
		case "error":
			return status.error ?? "Update check failed.";
		default:
			return null;
	}
}

function UpdatesPanel() {
	const switchId = useId();
	const config = useAppSettingsStore((s) => s.config);
	const setAutoUpdate = useAppSettingsStore((s) => s.setAutoUpdate);
	const status = useUpdateStore((s) => s.status);
	// `null` = not chosen yet; treat as off until the user opts in.
	const enabled = config?.autoUpdate === true;
	const busy = status.state === "checking" || status.state === "downloading";
	const statusLabel = updateStatusLabel(status);

	return (
		<SectionPane
			title="Updates"
			description="How Cross TTS keeps itself up to date."
		>
			<div className="rounded-lg border border-border bg-muted/20 p-4">
				<label
					htmlFor={switchId}
					className="flex cursor-pointer items-center justify-between gap-4"
				>
					<span className="flex items-center gap-2 text-sm font-medium">
						<RefreshCw className="size-4 text-muted-foreground" aria-hidden />
						Automatic updates
					</span>
					<Switch
						id={switchId}
						checked={enabled}
						onCheckedChange={(v) => void setAutoUpdate(v)}
					/>
				</label>
				<p className="mt-3 text-xs text-muted-foreground">
					When on, new versions download in the background and install the next
					time you restart. When off, Cross TTS never checks for updates — grab
					new releases yourself from GitHub, or use the button below.
				</p>
			</div>
			{isDesktopApp() ? (
				<div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-4">
					{status.state === "ready" ? (
						<Button
							type="button"
							size="sm"
							onClick={() => void quitAndInstallUpdate()}
						>
							<RotateCcw className="mr-2 size-4" aria-hidden />
							Restart to update
						</Button>
					) : (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => void checkForUpdates()}
						>
							{busy ? (
								<Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
							) : (
								<Download className="mr-2 size-4" aria-hidden />
							)}
							Check for updates
						</Button>
					)}
					{statusLabel ? (
						<p
							className={cn(
								"text-xs",
								status.state === "error"
									? "text-destructive"
									: "text-muted-foreground",
							)}
							aria-live="polite"
						>
							{statusLabel}
						</p>
					) : null}
				</div>
			) : null}
			<p className="mt-3 text-[11px] text-muted-foreground">
				Updates only apply to the installed desktop app.
			</p>
		</SectionPane>
	);
}

function formatPauseMs(ms: number): string {
	if (ms === 0) return "Off";
	if (ms >= 1000) {
		return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")} s`;
	}
	return `${ms} ms`;
}

/** An engine's licence terms; with `onAccept`, the one-time acknowledgement. */
function LicenceDialog({
	engine,
	open,
	onOpenChange,
	onAccept,
}: {
	engine: TtsEngine;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAccept?: () => void;
}) {
	const terms = engine.licence.acknowledge;
	if (!terms) return null;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
				<DialogTitle>
					{engine.displayName} — {engine.licence.name} licence
				</DialogTitle>
				<DialogDescription>
					The {engine.displayName} model is downloaded from HuggingFace and
					licensed to you by its authors under {engine.licence.name}, not by
					Cross TTS. Its terms forbid using the model or its output to:
				</DialogDescription>
				<ScrollArea className="min-h-0 flex-1 pr-3">
					<ul className="list-disc space-y-1 pl-5 text-sm">
						{terms.summary.map((r) => (
							<li key={r}>{r}</li>
						))}
					</ul>
					<details className="mt-4 text-xs">
						<summary className="cursor-pointer font-medium">
							Full licence text
						</summary>
						<pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
							{terms.text}
						</pre>
					</details>
					<p className="mt-3 text-xs text-muted-foreground">
						A copy of the licence is saved next to the downloaded model.
					</p>
				</ScrollArea>
				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{onAccept ? "Cancel" : "Close"}
					</Button>
					{onAccept ? (
						<Button onClick={onAccept}>Accept and use {engine.displayName}</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function EngineControl() {
	const engineId = useTtsStore((s) => s.engineId);
	const voice = useTtsStore((s) => s.voice);
	const setEngine = useTtsStore((s) => s.setEngine);
	const accepted = useTtsStore((s) => s.licencesAccepted);
	const steps = useTtsStore((s) => s.supertonicSteps);
	const modelPhase = useTtsStore((s) => s.modelPhase);
	const modelProgress = useTtsStore((s) => s.modelProgress);
	const engine = getTtsEngine(engineId);
	/** Engine waiting for its licence to be accepted before it's selected. */
	const [pending, setPending] = useState<TtsEngine | null>(null);
	const [viewLicence, setViewLicence] = useState(false);
	const [stepsDraft, setStepsDraft] = useState<number | null>(null);

	const select = (next: TtsEngine) =>
		setEngine(next.id, coerceEngineVoice(next, voice));
	const onPick = (id: string) => {
		const next = getTtsEngine(id);
		if (next.licence.acknowledge && !accepted.includes(next.id)) setPending(next);
		else select(next);
	};

	return (
		<div className="mb-3 rounded-lg border border-border bg-muted/20 p-4">
			<div className="mb-3 text-sm font-medium">Voice engine</div>
			<Select value={engine.id} onValueChange={onPick}>
				<SelectTrigger className="w-full" aria-label="Voice engine">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{TTS_ENGINES.map((e) => (
						<SelectItem key={e.id} value={e.id}>
							{e.displayName}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="mt-3 text-xs text-muted-foreground">
				{engine.listVoices().length} voices · {engine.languages.join(", ")} ·{" "}
				{engine.licence.name} licence
				{engine.licence.acknowledge ? (
					<>
						{" "}
						(
						<button
							type="button"
							className="underline underline-offset-2 hover:text-foreground"
							onClick={() => setViewLicence(true)}
						>
							terms
						</button>
						)
					</>
				) : null}
				. Each book remembers its engine and voice.
			</p>
			{engine.id === "supertonic" ? (
				<div className="mt-4 space-y-4">
					<div>
						<div className="flex items-center justify-between gap-4 text-sm font-medium">
							<span>Quality</span>
							<span className="text-xs tabular-nums text-muted-foreground">
								{stepsDraft ?? steps} steps
							</span>
						</div>
						<Slider
							className="mt-3"
							aria-label="Supertonic quality (denoising steps)"
							min={SUPERTONIC_MIN_STEPS}
							max={SUPERTONIC_MAX_STEPS}
							step={1}
							value={[stepsDraft ?? steps]}
							onValueChange={(v) => setStepsDraft(v[0] ?? steps)}
							onValueCommit={(v) => {
								setStepsDraft(null);
								useTtsStore.getState().setSupertonicSteps(v[0] ?? steps);
							}}
						/>
						<p className="mt-2 text-xs text-muted-foreground">
							Denoising steps per sentence. More sounds cleaner but takes
							longer; {SUPERTONIC_DEFAULT_STEPS} is the model&apos;s
							default.
						</p>
					</div>
					<div className="flex items-center gap-3">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="gap-2"
							disabled={modelPhase === "loading" || modelPhase === "ready"}
							onClick={() => void ensureTtsLoaded().catch(() => {})}
						>
							{modelPhase === "loading" ? (
								<Loader2 className="size-4 animate-spin" aria-hidden />
							) : modelPhase === "ready" ? (
								<CheckCircle2 className="size-4" aria-hidden />
							) : (
								<Download className="size-4" aria-hidden />
							)}
							{modelPhase === "ready" ? "Model ready" : "Download model (~400 MB)"}
						</Button>
						{modelPhase === "loading" && modelProgress !== null ? (
							<Progress
								className="h-1.5 flex-1"
								value={Math.round(modelProgress * 100)}
							/>
						) : null}
					</div>
				</div>
			) : null}
			<LicenceDialog
				engine={engine}
				open={viewLicence}
				onOpenChange={setViewLicence}
			/>
			{pending ? (
				<LicenceDialog
					engine={pending}
					open
					onOpenChange={(open) => {
						if (!open) setPending(null);
					}}
					onAccept={() => {
						const { licencesAccepted, setLicencesAccepted } =
							useTtsStore.getState();
						setLicencesAccepted([...licencesAccepted, pending.id]);
						select(pending);
						setPending(null);
					}}
				/>
			) : null}
		</div>
	);
}

function PlaybackPanel() {
	const stored = useTtsStore((s) => s.sentencePauseMs);
	const setSentencePauseMs = useTtsStore((s) => s.setSentencePauseMs);
	// `null` while not dragging → show the stored value; a number while dragging.
	const [draft, setDraft] = useState<number | null>(null);
	const shown = draft ?? stored;

	return (
		<SectionPane
			title="Playback"
			description="How reading flows from sentence to sentence."
		>
			<EngineControl />
			<div className="rounded-lg border border-border bg-muted/20 p-4">
				<div className="flex items-center justify-between gap-4">
					<span className="flex items-center gap-2 text-sm font-medium">
						<AudioLines
							className="size-4 text-muted-foreground"
							aria-hidden
						/>
						Pause between sentences
					</span>
					<span className="text-xs font-medium tabular-nums text-muted-foreground">
						{formatPauseMs(shown)}
					</span>
				</div>
				<Slider
					className="mt-4"
					aria-label="Pause between sentences"
					min={0}
					max={MAX_SENTENCE_PAUSE_MS}
					step={50}
					value={[Math.min(shown, MAX_SENTENCE_PAUSE_MS)]}
					onValueChange={(v) => setDraft(v[0] ?? 0)}
					onValueCommit={(v) => {
						setDraft(null);
						setSentencePauseMs(v[0] ?? 0);
					}}
				/>
				<div className="mt-2 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
					<span>Off</span>
					<span>{MAX_SENTENCE_PAUSE_MS / 1000} s</span>
				</div>
				<p className="mt-3 text-xs text-muted-foreground">
					Adds a moment of silence after each sentence while listening — a
					slower, more deliberate pace. Also applied to audiobook exports.
					Applies from the next sentence; no restart needed.
				</p>
			</div>
		</SectionPane>
	);
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
	const [section, setSection] = useState<SectionId>("appearance");
	const hydrate = useAppSettingsStore((s) => s.hydrate);
	const refresh = useAppSettingsStore((s) => s.refresh);
	const appVersion = useAppSettingsStore((s) => s.config?.appVersion);

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
					<p className="mt-auto px-2 pt-3 text-[11px] text-muted-foreground">
						Cross TTS{appVersion ? ` v${appVersion}` : ""}
					</p>
				</nav>

				{/* Right content pane. */}
				<div className="min-h-0 min-w-0 flex-1">
					{section === "appearance" ? <AppearancePanel /> : null}
					{section === "playback" ? <PlaybackPanel /> : null}
					{section === "storage" ? <StoragePanel /> : null}
					{section === "performance" ? <PerformancePanel /> : null}
					{section === "shortcuts" ? <ShortcutsPanel /> : null}
					{section === "updates" ? <UpdatesPanel /> : null}
					{section === "rules" ? (
						<TtsRulesPanel active={section === "rules"} />
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
