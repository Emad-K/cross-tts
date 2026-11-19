import { CheckCircle2, ChevronRight, Download } from "lucide-react";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import type { GpuPowerPreference } from "@shared/appConfig";
import {
	MAX_CHUNK_CHARS_MAX,
	MAX_CHUNK_CHARS_MIN,
	MAX_CHUNK_CHARS_STEP,
	defaultAppearance,
} from "@shared/appearance";
import {
	MODEL_BYTES,
	MODEL_LABEL,
	SUPERTONIC_BYTES,
	type ModelKind,
} from "@shared/modelAssets";
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
	downloadModel,
	getGpuInfo,
	getModelStatus,
	openExternal,
	removeModel,
	subscribeToModelProgress,
	supertonicPresent,
} from "@/lib/desktopBridge";
import { cn } from "@/lib/utils";
import { isExportPhaseActive, useExportStore } from "../audiobook/exportStore";
import {
	coerceEngineVoice,
	ensureTtsLoaded,
	getActiveDevice,
	getTtsEngine,
	MAX_SENTENCE_PAUSE_MS,
	resetTtsEngine,
	seekToChunkAndMaybePlay,
	TTS_ENGINES,
	useTtsStore,
} from "../tts";
import { softwareAdapterReason } from "../tts/gpuAdapter";
import { engineModels, modelOnDisk, type ModelsOnDisk } from "../tts/modelOnDisk";
import {
	SUPERTONIC_DEFAULT_STEPS,
	SUPERTONIC_MAX_STEPS,
	SUPERTONIC_MIN_STEPS,
	SUPERTONIC_STYLES,
} from "../tts/supertonicModel";
import { supertonicLanguageName } from "../tts/supertonicVoices";
import type { TtsEngine } from "../tts/ttsEngineTypes";
import { VoicePicker } from "../VoicePicker";
import { maxCpuThreads, useAppSettingsStore } from "./appSettingsStore";
import { mb, SectionPane } from "./SectionPane";
import { RemoveCudaAddon, SpeechBackendControl, SpeedTest } from "./SpeechBackendControl";

const BOX = "mt-3 rounded-lg border border-border bg-muted/20 p-4";
const HELP = "mt-3 text-xs text-muted-foreground";
const ENDS = "mt-2 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground";

/** Which model files are on disk, and the downloads Settings started. */
type ModelFiles = {
	/** Null until the main process answered (and in the browser build). */
	disk: ModelsOnDisk | null;
	/** Percent done per model being downloaded. */
	progress: Partial<Record<ModelKind, number>>;
	download: (kind: ModelKind) => void;
	remove: (kind: ModelKind) => void;
};

export function useModelFiles(): ModelFiles {
	const [disk, setDisk] = useState<ModelsOnDisk | null>(null);
	const [progress, setProgress] = useState<ModelFiles["progress"]>({});
	// Loading a model (pressing Play) can download it too: look again after.
	const modelPhase = useTtsStore((s) => s.modelPhase);

	const refresh = useCallback(async () => {
		const [status, supertonic] = await Promise.all([getModelStatus(), supertonicPresent()]);
		if (status) setDisk({ status, supertonic });
	}, []);
	const setPct = (kind: ModelKind, pct?: number) =>
		setProgress(({ [kind]: _, ...rest }) => (pct === undefined ? rest : { ...rest, [kind]: pct }));

	useEffect(() => void refresh(), [refresh, modelPhase]);
	useEffect(
		() =>
			subscribeToModelProgress((p) => {
				if (p.done) return;
				setPct(p.kind, p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0);
			}),
		[],
	);

	return {
		disk,
		progress,
		download: (kind) => {
			setPct(kind, 0);
			// A failed download is in the log; the row goes back to "Download".
			void downloadModel(kind).finally(() => {
				setPct(kind);
				void refresh();
			});
		},
		remove: (kind) => {
			// The model may be the loaded one.
			resetTtsEngine();
			void removeModel(kind).finally(() => void refresh());
		},
	};
}

/** "Downloaded", a download in progress, or the button that starts one. */
function ModelDownload({
	label,
	bytes,
	present,
	pct,
	disabled,
	onDownload,
	onRemove,
}: {
	label: string;
	bytes: number;
	/** Undefined while it isn't known yet. */
	present: boolean | undefined;
	pct: number | undefined;
	disabled?: boolean;
	onDownload: () => void;
	onRemove?: () => void;
}) {
	if (present === undefined) return null;
	if (present) {
		return (
			<span className="flex items-center gap-2 text-xs text-muted-foreground">
				<CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
				Downloaded
				{onRemove ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs"
						aria-label={`Remove ${label} (frees ${mb(bytes)} MB)`}
						onClick={onRemove}
					>
						Remove
					</Button>
				) : null}
			</span>
		);
	}
	if (pct !== undefined) {
		return (
			<span className="flex min-w-0 flex-1 items-center gap-2 text-xs tabular-nums text-muted-foreground">
				<span className="shrink-0">Downloading… {pct}%</span>
				<Progress value={pct} className="h-1.5 max-w-40 flex-1" aria-label={`Downloading ${label}`} />
			</span>
		);
	}
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="h-7 gap-1.5 px-2 text-xs"
			aria-label={`Download ${label} (${mb(bytes)} MB)`}
			disabled={disabled}
			onClick={onDownload}
		>
			<Download className="size-3.5" aria-hidden />
			Download ({mb(bytes)} MB)
		</Button>
	);
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

/** One line on what sets an engine apart; the numbers come from its voice list. */
function engineBlurb(engine: TtsEngine): string {
	const voices = engine.listVoices().length;
	switch (engine.id) {
		case "phonon":
			return `The smallest download. ${voices} voices, some of them characters.`;
		case "supertonic":
			return `The most languages. ${SUPERTONIC_STYLES.length} voices in each, with adjustable quality.`;
		default:
			return `The default engine. ${voices} voices.`;
	}
}

/** "English, Spanish, French" from an engine's language codes (regions folded). */
function languageList(codes: readonly string[]): string {
	const names = [...new Set(codes.map((c) => supertonicLanguageName(c.split("-")[0]!)))];
	return names.length <= 6
		? names.join(", ")
		: `${names.slice(0, 3).join(", ")} and ${names.length - 3} more languages`;
}

const LINK = "underline underline-offset-2 hover:text-foreground";

export function EngineCards({ files }: { files: ModelFiles }) {
	const name = useId();
	const legendId = useId();
	const engineId = useTtsStore((s) => s.engineId);
	const voice = useTtsStore((s) => s.voice);
	const setEngine = useTtsStore((s) => s.setEngine);
	const accepted = useTtsStore((s) => s.licencesAccepted);
	const modelPhase = useTtsStore((s) => s.modelPhase);
	const modelProgress = useTtsStore((s) => s.modelProgress);
	const config = useAppSettingsStore((s) => s.config);
	// An export is bound to the engine (and steps) it started with.
	const exporting = useExportStore((s) => isExportPhaseActive(s.phase));
	const engine = getTtsEngine(engineId);
	/** Engine waiting for its licence to be accepted before it's selected. */
	const [pending, setPending] = useState<{ engine: TtsEngine; download: boolean } | null>(
		null,
	);
	const [viewLicence, setViewLicence] = useState<TtsEngine | null>(null);

	const needsAccept = (e: TtsEngine) =>
		!!e.licence.acknowledge && !accepted.includes(e.id);
	const select = (next: TtsEngine) =>
		setEngine(next.id, coerceEngineVoice(next, voice));
	const onPick = (next: TtsEngine) => {
		if (needsAccept(next)) setPending({ engine: next, download: false });
		else select(next);
	};
	// After the engine switch has settled (it unloads the previous engine).
	const loadSoon = () => setTimeout(() => void ensureTtsLoaded().catch(() => {}), 0);

	return (
		<fieldset role="radiogroup" aria-labelledby={legendId} className="space-y-2">
			<legend id={legendId} className="mb-3 text-sm font-medium">
				Voice engine
			</legend>
			{TTS_ENGINES.map((e) => {
				const selected = e.id === engine.id;
				const model = engineModels(
					e.id,
					config?.ttsBackend ?? "auto",
					config?.backends.native ?? true,
				)[0]!;
				const present = files.disk ? modelOnDisk(model, files.disk) : undefined;
				// Supertonic's files come through its own loader, so downloading it
				// means selecting it (licence first) and loading it.
				const ownLoader = model === "supertonic";
				const pct = !ownLoader
					? files.progress[model]
					: selected && modelPhase === "loading"
						? Math.round((modelProgress ?? 0) * 100)
						: undefined;
				return (
					<div
						key={e.id}
						className={cn(
							"rounded-lg border p-3 transition-colors",
							selected ? "border-primary bg-primary/5" : "border-border bg-muted/20",
						)}
					>
						<label
							className={cn(
								"flex items-start gap-3",
								exporting ? "cursor-not-allowed opacity-60" : "cursor-pointer",
							)}
						>
							<input
								type="radio"
								name={name}
								value={e.id}
								checked={selected}
								disabled={exporting}
								onChange={() => onPick(e)}
								className="mt-0.5 size-4 shrink-0 accent-primary"
							/>
							<span className="min-w-0 flex-1 space-y-0.5">
								<span className="block text-sm font-medium leading-5">
									{e.displayName}
								</span>
								<span className="block text-xs text-muted-foreground">
									{engineBlurb(e)}
								</span>
								<span className="block text-xs text-muted-foreground">
									{languageList(e.languages)}
								</span>
							</span>
						</label>
						<div className="mt-2 flex min-h-7 items-center justify-between gap-3 pl-7 text-xs text-muted-foreground">
							<ModelDownload
								label={e.displayName}
								bytes={ownLoader ? SUPERTONIC_BYTES : MODEL_BYTES[model]}
								present={present}
								pct={pct}
								disabled={ownLoader && !selected && exporting}
								onDownload={() => {
									if (!ownLoader) files.download(model);
									else if (needsAccept(e)) setPending({ engine: e, download: true });
									else {
										if (!selected) select(e);
										loadSoon();
									}
								}}
							/>
							<span className="ml-auto flex shrink-0 gap-3">
								{selected && needsAccept(e) ? (
									<button
										type="button"
										className={cn(LINK, "text-amber-500")}
										onClick={() => setPending({ engine: e, download: false })}
									>
										Accept the licence to use it
									</button>
								) : null}
								<button
									type="button"
									className={LINK}
									aria-label={`${e.displayName} licence (${e.licence.name})`}
									onClick={() =>
										e.licence.acknowledge
											? setViewLicence(e)
											: void openExternal(e.licence.url)
									}
								>
									Licence
								</button>
							</span>
						</div>
						{selected && e.licence.notice ? (
							<p className="mt-2 pl-7 text-[11px] text-muted-foreground">
								{e.licence.notice}
							</p>
						) : null}
					</div>
				);
			})}
			<p className="pt-1 text-xs text-muted-foreground">
				An engine downloads when you first press Play with it, or download it
				now. Each book remembers its engine and voice.
			</p>
			{viewLicence ? (
				<LicenceDialog
					engine={viewLicence}
					open
					onOpenChange={(open) => !open && setViewLicence(null)}
				/>
			) : null}
			{pending ? (
				<LicenceDialog
					engine={pending.engine}
					open
					onOpenChange={(open) => !open && setPending(null)}
					onAccept={() => {
						const { licencesAccepted, setLicencesAccepted } = useTtsStore.getState();
						setLicencesAccepted([...licencesAccepted, pending.engine.id]);
						// Already selected: clear the refused load so Play works again.
						if (pending.engine.id === engine.id) resetTtsEngine();
						else select(pending.engine);
						if (pending.download) loadSoon();
						setPending(null);
					}}
				/>
			) : null}
		</fieldset>
	);
}

export function VoiceControl() {
	const exporting = useExportStore((s) => isExportPhaseActive(s.phase));
	return (
		<div className={cn(BOX, "flex items-center justify-between gap-4")}>
			<span className="text-sm font-medium">Voice</span>
			<VoicePicker disabled={exporting} className="min-w-[12rem]" />
		</div>
	);
}

/** Supertonic's denoising steps, as a plain quality slider. */
function QualityControl() {
	const steps = useTtsStore((s) => s.supertonicSteps);
	const exporting = useExportStore((s) => isExportPhaseActive(s.phase));
	const [draft, setDraft] = useState<number | null>(null);
	return (
		<div className={BOX}>
			<div className="flex items-center justify-between gap-4 text-sm font-medium">
				<span>Quality</span>
				<span className="text-xs tabular-nums text-muted-foreground">{draft ?? steps}</span>
			</div>
			<Slider
				className="mt-4"
				aria-label="Quality"
				disabled={exporting}
				min={SUPERTONIC_MIN_STEPS}
				max={SUPERTONIC_MAX_STEPS}
				step={1}
				value={[draft ?? steps]}
				onValueChange={(v) => setDraft(v[0] ?? steps)}
				onValueCommit={(v) => {
					setDraft(null);
					useTtsStore.getState().setSupertonicSteps(v[0] ?? steps);
				}}
			/>
			<div className={ENDS}>
				<span>Faster</span>
				<span>Cleaner</span>
			</div>
			<p className={HELP}>
				Higher sounds cleaner but takes longer. {SUPERTONIC_DEFAULT_STEPS} is the
				model&apos;s own setting.
			</p>
		</div>
	);
}

function formatPauseMs(ms: number): string {
	if (ms === 0) return "Off";
	if (ms >= 1000) {
		return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")} s`;
	}
	return `${ms} ms`;
}

function PauseControl() {
	const stored = useTtsStore((s) => s.sentencePauseMs);
	const setSentencePauseMs = useTtsStore((s) => s.setSentencePauseMs);
	// `null` while not dragging → show the stored value; a number while dragging.
	const [draft, setDraft] = useState<number | null>(null);
	const shown = draft ?? stored;
	return (
		<div className={BOX}>
			<div className="flex items-center justify-between gap-4">
				<span className="text-sm font-medium">Pause between sentences</span>
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
			<div className={ENDS}>
				<span>Off</span>
				<span>{MAX_SENTENCE_PAUSE_MS / 1000} s</span>
			</div>
			<p className={HELP}>
				Adds a moment of silence after each sentence while listening — a
				slower, more deliberate pace. Also applied to audiobook exports.
				Applies from the next sentence; no restart needed.
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
	const labelId = useId();
	const config = useAppSettingsStore((s) => s.config);
	const setGpuPower = useAppSettingsStore((s) => s.setGpuPower);
	const power = config?.gpuPower ?? "auto";
	const [probe, setProbe] = useState<{ high?: string; low?: string }>({});
	const [detected, setDetected] = useState<string[]>([]);

	useEffect(() => {
		let cancelled = false;
		void getGpuInfo().then((info) => {
			if (!cancelled) setDetected(info.gpus);
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
				if (!cancelled) setProbe({ high, low });
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
		{ id: "auto", label: "Automatic (recommended)" },
		{
			id: "high-performance",
			label: probe.high ?? detected[0] ?? "Faster graphics card",
		},
		{ id: "low-power", label: probe.low ?? "Power-saving graphics card" },
	];

	return (
		<div className={BOX}>
			<div id={labelId} className="mb-3 text-sm font-medium">
				Which graphics card
			</div>
			<Select value={power} onValueChange={(v) => onChange(v as GpuPowerPreference)}>
				<SelectTrigger className="w-full" aria-labelledby={labelId}>
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
			{detected.length > 0 ? (
				<p className="mt-3 break-words text-xs text-muted-foreground">
					Detected: {detected.join(", ")}
				</p>
			) : null}
			<p className="mt-1.5 text-xs text-muted-foreground">
				Only matters on computers with two graphics cards. The choice is
				between the faster (dedicated) one and the power-saving (built-in) one.
			</p>
		</div>
	);
}

function GpuFp16Control({ files }: { files: ModelFiles }) {
	const switchId = useId();
	const config = useAppSettingsStore((s) => s.config);
	const setGpuFp16 = useAppSettingsStore((s) => s.setGpuFp16);
	if (!config) return null;
	const onToggle = async (next: boolean) => {
		await setGpuFp16(next);
		// The GPU model's precision is chosen when it loads (and a failed fp16
		// load may have left the engine on the CPU).
		resetTtsEngine();
	};
	return (
		<div className={BOX}>
			<label
				htmlFor={switchId}
				className="flex cursor-pointer items-center justify-between gap-4"
			>
				<span className="text-sm font-medium">
					Smaller graphics-card model (experimental)
				</span>
				<Switch
					id={switchId}
					checked={config.gpuFp16}
					onCheckedChange={(v) => void onToggle(v)}
				/>
			</label>
			<p className={HELP}>
				Kokoro only. Uses a model half the size ({mb(MODEL_BYTES.fp16)} MB
				instead of {mb(MODEL_BYTES.gpu)} MB) when your graphics card supports
				it and it is downloaded; otherwise the full model. It may sound
				slightly different; switch off if it does.
			</p>
			<div className="mt-3 flex min-h-7 items-center">
				<ModelDownload
					label={MODEL_LABEL.fp16}
					bytes={MODEL_BYTES.fp16}
					present={files.disk?.status.fp16.present}
					pct={files.progress.fp16}
					onDownload={() => files.download("fp16")}
					onRemove={() => files.remove("fp16")}
				/>
			</div>
		</div>
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
		<div className={BOX}>
			<div className="flex items-center justify-between gap-4">
				<span className="text-sm font-medium">Processor threads</span>
				<span className="text-xs font-medium tabular-nums text-muted-foreground">
					{shown === 0 ? "Auto" : shown}
				</span>
			</div>
			<Slider
				className="mt-4"
				aria-label="Processor threads"
				min={0}
				max={max}
				step={1}
				value={[Math.min(shown, max)]}
				onValueChange={(v) => setDraft(v[0] ?? 0)}
				onValueCommit={(v) => commit(v[0] ?? 0)}
			/>
			<div className={ENDS}>
				<span>Auto</span>
				<span>{max} (max)</span>
			</div>
			<p className={HELP}>
				How much of the processor speech may use. Auto picks a sensible amount
				for the voice engine; the most is one less than your {max + 1} cores.
			</p>
		</div>
	);
}

function SentenceLengthControl() {
	const config = useAppSettingsStore((s) => s.config);
	const setAppearance = useAppSettingsStore((s) => s.setAppearance);
	const stored = (config?.appearance ?? defaultAppearance()).maxChunkChars;
	const [draft, setDraft] = useState<number | null>(null);
	return (
		<div className={BOX}>
			<div className="flex items-center justify-between gap-4">
				<span className="text-sm font-medium">Sentence length</span>
				<span className="text-xs font-medium tabular-nums text-muted-foreground">
					up to {draft ?? stored} characters
				</span>
			</div>
			<Slider
				className="mt-4"
				aria-label="Sentence length"
				value={[draft ?? stored]}
				min={MAX_CHUNK_CHARS_MIN}
				max={MAX_CHUNK_CHARS_MAX}
				step={MAX_CHUNK_CHARS_STEP}
				onValueChange={(v) => setDraft(v[0] ?? MAX_CHUNK_CHARS_MIN)}
				onValueCommit={(v) => {
					setDraft(null);
					void setAppearance({ maxChunkChars: v[0] ?? MAX_CHUNK_CHARS_MIN });
					// Rebuild the open document's chunks with the new size.
					useTtsStore.getState().rechunk();
					// Restart (or drop, if paused) the loop at the mapped position.
					seekToChunkAndMaybePlay(useTtsStore.getState().currentChunkIndex);
				}}
			/>
			<div className={ENDS}>
				<span>Shorter</span>
				<span>Longer</span>
			</div>
			<p className={HELP}>
				The most text read out (and highlighted) in one go. Shorter starts
				sooner and highlights more finely; longer has fewer breaks. On Linux,
				very long stretches can sound slightly off: lower this if you notice
				it.
			</p>
		</div>
	);
}

function CompatibilityModel({ files }: { files: ModelFiles }) {
	return (
		<div className={BOX}>
			<div className="flex min-h-7 items-center justify-between gap-4">
				<span className="text-sm font-medium">{MODEL_LABEL.cpu}</span>
				<ModelDownload
					label={MODEL_LABEL.cpu}
					bytes={MODEL_BYTES.cpu}
					present={files.disk?.status.cpu.present}
					pct={files.progress.cpu}
					onDownload={() => files.download("cpu")}
					onRemove={() => files.remove("cpu")}
				/>
			</div>
			<p className={HELP}>
				Kokoro&apos;s smaller model, used only when speech runs on the processor
				in compatibility mode. It downloads the first time that happens, or
				download it now.
			</p>
		</div>
	);
}

function AdvancedBody({ files }: { files: ModelFiles }) {
	const config = useAppSettingsStore((s) => s.config);
	const webgpuAvailable = useAppSettingsStore((s) => s.webgpuAvailable);
	const setWebgpuAvailable = useAppSettingsStore((s) => s.setWebgpuAvailable);
	const engineId = useTtsStore((s) => s.engineId);
	// Re-render when a model loads or unloads: it decides what speech runs on.
	useTtsStore((s) => s.modelPhase);
	const engine = getTtsEngine(engineId);
	const backend = config?.ttsBackend;

	useEffect(() => {
		if (webgpuAvailable !== null || typeof navigator === "undefined") return;
		void (async () => {
			try {
				const adapter = await navigator.gpu?.requestAdapter();
				// A software rasterizer is no GPU (same rule as the engine's probe).
				setWebgpuAvailable(!!adapter && !softwareAdapterReason(adapter));
			} catch {
				setWebgpuAvailable(false);
			}
		})();
	}, [webgpuAvailable, setWebgpuAvailable]);

	// The graphics-card options apply when the choice can use WebGPU.
	const mayUseWebgpu =
		!!engine.runningOn &&
		(backend === "auto" || backend === "webgpu") &&
		webgpuAvailable !== false;
	const running = engine.runningOn?.() ?? null;
	// Shown when speech runs on the processor, or will with this choice.
	const onProcessor =
		!engine.runningOn ||
		backend === "cpu" ||
		backend === "wasm" ||
		running === "cpu" ||
		running === "wasm" ||
		(engineId === "supertonic" && backend !== "webgpu") ||
		(backend === "auto" && webgpuAvailable === false);

	return (
		<div className="pt-1">
			<SpeechBackendControl disk={files.disk} />
			{mayUseWebgpu ? <GpuPreferenceControl /> : null}
			{mayUseWebgpu && engineId === "kokoro" ? <GpuFp16Control files={files} /> : null}
			{onProcessor ? <CpuThreadsControl /> : null}
			<SentenceLengthControl />
			<SpeedTest disk={files.disk} />
			<RemoveCudaAddon />
			<CompatibilityModel files={files} />
		</div>
	);
}

/** Collapsed by default; its controls (and their hardware probes) mount on open. */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<details className="group mt-6" onToggle={(e) => setOpen(e.currentTarget.open)}>
			<summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
				<ChevronRight
					className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
					aria-hidden
				/>
				{summary}
			</summary>
			{open ? children : null}
		</details>
	);
}

export function VoicePanel() {
	const files = useModelFiles();
	const engineId = useTtsStore((s) => s.engineId);
	return (
		<SectionPane title="Voice" description="Choose who reads to you.">
			<EngineCards files={files} />
			<VoiceControl />
			{engineId === "supertonic" ? <QualityControl /> : null}
			<PauseControl />
			<Disclosure summary="Advanced: speed and hardware">
				<AdvancedBody files={files} />
			</Disclosure>
		</SectionPane>
	);
}
