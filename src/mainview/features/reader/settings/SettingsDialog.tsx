import {
	CheckCircle2,
	Cpu,
	Download,
	FolderCog,
	FolderOpen,
	Keyboard,
	Loader2,
	Palette,
	RefreshCw,
	RotateCcw,
	Wand2,
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
	chooseDataDirectory,
	downloadModel,
	getGpuInfo,
	getModelStatus,
	relaunchApp,
	resetDataDirectory,
	revealDataDirectory,
	subscribeToModelProgress,
} from "@/lib/desktopBridge";
import { cn } from "@/lib/utils";
import { getActiveDevice, resetKokoroEngine } from "../tts";
import { AppearancePanel } from "./AppearancePanel";
import { maxCpuThreads, useAppSettingsStore } from "./appSettingsStore";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { TtsRulesPanel } from "./TtsRulesPanel";

type SectionId =
	| "appearance"
	| "storage"
	| "performance"
	| "shortcuts"
	| "updates"
	| "rules";

const NAV: { id: SectionId; label: string; icon: typeof FolderCog }[] = [
	{ id: "appearance", label: "Appearance", icon: Palette },
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
		if (getActiveDevice() === "webgpu") resetKokoroEngine();
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
			{gpuEnabled && webgpuAvailable !== false ? <GpuPreferenceControl /> : null}
			<CpuThreadsControl />
		</SectionPane>
	);
}

function UpdatesPanel() {
	const switchId = useId();
	const config = useAppSettingsStore((s) => s.config);
	const setAutoUpdate = useAppSettingsStore((s) => s.setAutoUpdate);
	// `null` = not chosen yet; treat as off until the user opts in.
	const enabled = config?.autoUpdate === true;

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
					new releases yourself from GitHub.
				</p>
			</div>
			<p className="mt-3 text-[11px] text-muted-foreground">
				Updates only apply to the installed desktop app.
			</p>
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
