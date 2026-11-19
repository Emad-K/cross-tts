import { Gauge } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { TtsBackend } from "@shared/appConfig";
import { MODEL_BYTES } from "@shared/modelAssets";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	cudaAddonCancel,
	cudaAddonInstall,
	cudaAddonRemove,
	onCudaAddonProgress,
} from "@/lib/desktopBridge";
import { isExportPhaseActive, useExportStore } from "../audiobook/exportStore";
import { getTtsEngine, resetTtsEngine, useTtsStore } from "../tts";
import { BACKEND_LABEL, RUNNING_LABEL, type RunningBackend } from "../tts/backendChoice";
import type { ModelsOnDisk } from "../tts/modelOnDisk";
import {
	type BenchmarkCandidate,
	type BenchmarkRow,
	benchmarkCandidates,
	fasterChoice,
	runBenchmark,
} from "../tts/benchmark";
import { effectiveCpuThreads, useAppSettingsStore } from "./appSettingsStore";
import { mb } from "./SectionPane";

const LABEL = BACKEND_LABEL;

/** Store a backend choice and drop the loaded model, so the next play loads the chosen one. */
async function applyBackend(backend: TtsBackend): Promise<void> {
	await useAppSettingsStore.getState().setTtsBackend(backend);
	// Backends use different model weights and processes.
	resetTtsEngine();
}

/**
 * Confirm, download and verify the CUDA add-on. Nothing is downloaded until
 * "Download" is clicked. Cancel (or the close button) stops a download in
 * progress; a stray click outside or Esc doesn't.
 */
function CudaAddonDialog({
	open,
	bytes,
	onClose,
	onInstalled,
}: {
	open: boolean;
	bytes: number;
	onClose: () => void;
	onInstalled: () => void;
}) {
	const setConfig = useAppSettingsStore((s) => s.setConfig);
	const movedDataDir = useAppSettingsStore((s) => s.config?.isDefaultDataDir === false);
	const [progress, setProgress] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const downloading = progress !== null;

	const download = async () => {
		setError(null);
		setProgress(0);
		const unsubscribe = onCudaAddonProgress(({ loaded, total }) =>
			setProgress(total > 0 ? (loaded / total) * 100 : 0),
		);
		try {
			const result = await cudaAddonInstall();
			if (result?.ok) {
				setConfig(result.config);
				onInstalled();
			} else if (result && !result.cancelled) {
				setError(result.error);
			}
		} finally {
			unsubscribe();
			setProgress(null);
		}
	};

	const close = () => {
		if (downloading) void cudaAddonCancel();
		setError(null);
		onClose();
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && close()}>
			<DialogContent
				className="max-w-md"
				onInteractOutside={(e) => downloading && e.preventDefault()}
				onEscapeKeyDown={(e) => downloading && e.preventDefault()}
			>
				<DialogTitle>Download the NVIDIA add-on?</DialogTitle>
				<DialogDescription>
					Running speech on an NVIDIA graphics card needs extra libraries (ONNX
					Runtime&apos;s CUDA build), which
					are too large to ship with the app. This is a one-time {mb(bytes)} MB
					download from nuget.org (about 330 MB on disk), checked against a
					known checksum before it is used.
					{movedDataDir
						? " It is stored in the app's settings folder on the system drive, not in the data folder you chose."
						: ""}
				</DialogDescription>
				<p className="text-xs text-muted-foreground">
					How much graphics-card memory it uses can&apos;t be capped. If it
					can&apos;t start or runs out of memory, speech continues on the processor.
				</p>
				{/* Read out in steps of 10%, not on every tick. */}
				<p role="status" className="sr-only">
					{progress === null
						? ""
						: progress >= 100
							? "Verifying and unpacking"
							: `Downloaded ${Math.floor(progress / 10) * 10}%`}
				</p>
				{progress !== null ? (
					<div className="space-y-1.5">
						<Progress value={progress} aria-label="Download progress" />
						<p className="text-xs tabular-nums text-muted-foreground">
							{progress >= 100 ? "Verifying and unpacking…" : `${Math.floor(progress)}%`}
						</p>
					</div>
				) : null}
				{error ? (
					<p role="alert" className="text-xs text-destructive">
						Couldn&apos;t install the add-on: {error}
					</p>
				) : null}
				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={close}>
						Cancel
					</Button>
					<Button disabled={downloading} onClick={() => void download()}>
						{error ? "Try again" : `Download ${mb(bytes)} MB`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * The user-run benchmark: times the current engine on each backend this
 * machine has. Never starts on its own and only changes the backend when
 * "Use fastest" is clicked.
 */
function BackendBenchmark({
	candidates,
	onUse,
}: {
	candidates: BenchmarkCandidate[];
	onUse: (backend: RunningBackend) => void;
}) {
	const config = useAppSettingsStore((s) => s.config);
	const engineId = useTtsStore((s) => s.engineId);
	const playback = useTtsStore((s) => s.playback);
	const exporting = useExportStore((s) => isExportPhaseActive(s.phase));
	const [phase, setPhase] = useState<"idle" | "confirm" | "running" | "done">("idle");
	const [rows, setRows] = useState<BenchmarkRow[]>([]);
	const abort = useRef<AbortController | null>(null);

	// Leaving Settings (or switching engine) cancels a running benchmark.
	useEffect(() => () => abort.current?.abort(), [engineId]);
	useEffect(() => {
		setPhase("idle");
		setRows([]);
	}, [engineId]);

	const busy = playback !== "idle" && playback !== "paused";
	const blocked = busy || exporting;

	const start = async () => {
		const controller = new AbortController();
		abort.current = controller;
		setRows([]);
		setPhase("running");
		// Stops paused playback and unloads the model; the benchmark loads its own.
		resetTtsEngine();
		let finished = false;
		try {
			finished = await runBenchmark({
				engine: getTtsEngine(engineId),
				candidates,
				prefs: (backend) => ({
					backend,
					noFallback: true,
					gpuPower: config?.gpuPower ?? "auto",
					cpuThreads: effectiveCpuThreads(),
					gpuFp16: config?.gpuFp16 ?? false,
				}),
				voice: useTtsStore.getState().voice,
				signal: controller.signal,
				onRow: (row) => setRows((prev) => [...prev, row]),
			});
		} finally {
			// Clear what the benchmark left in the model status and audio cache.
			resetTtsEngine();
			if (abort.current === controller) {
				abort.current = null;
				// Stopped early (Cancel, or a setting changed): no result to act on.
				setPhase(finished ? "done" : "idle");
			}
		}
	};

	// For the confirm text: what will actually run, and whether a GPU is touched.
	const toRun = candidates.filter((c) => !c.skip).map((c) => c.backend);
	const usesGpu = toRun.some((b) => b !== "cpu" && b !== "wasm");

	const faster =
		phase === "done" && config ? fasterChoice(engineId, config.ttsBackend, rows) : null;

	return (
		<div className="mt-3 rounded-lg border border-border bg-muted/20 p-4">
			<div className="flex items-center justify-between gap-4">
				<span className="flex items-center gap-2 text-sm font-medium">
					<Gauge className="size-4 text-muted-foreground" aria-hidden />
					Test speed on this computer
				</span>
				{phase === "running" ? (
					<Button variant="outline" size="sm" onClick={() => abort.current?.abort()}>
						Cancel
					</Button>
				) : phase !== "confirm" ? (
					<Button
						variant="outline"
						size="sm"
						disabled={blocked}
						onClick={() => setPhase("confirm")}
					>
						{phase === "done" ? "Run again" : "Run test"}
					</Button>
				) : null}
			</div>
			<p className="mt-3 text-xs text-muted-foreground">
				{blocked && phase !== "running"
					? exporting
						? "Wait for the audiobook export to finish first."
						: "Pause playback first."
					: "Times one sentence on each option this computer has, so you can pick the fastest. It only runs when you start it."}
			</p>
			{phase === "confirm" ? (
				<div className="mt-3 rounded-md border border-border p-3">
					{toRun.length === 0 ? (
						<p className="text-xs">
							There is nothing to measure yet: the voice model isn&apos;t
							downloaded, and the test never downloads one. Play
							something first.
						</p>
					) : (
						<p className="text-xs">
							This loads the voice model on each of these in turn and reads
							one sentence twice: {toRun.map((b) => LABEL[b]).join(", ")}.{" "}
							{usesGpu ? "It briefly uses the graphics card. " : ""}
							It unloads the current model and stops paused playback at its
							sentence. No voice model is downloaded for it; only a small
							voice file (under 1 MB) if the selected voice has never been
							used.
						</p>
					)}
					<div className="mt-3 flex justify-end gap-2">
						<Button variant="outline" size="sm" onClick={() => setPhase("idle")}>
							Not now
						</Button>
						<Button
							size="sm"
							disabled={blocked || toRun.length === 0}
							onClick={() => void start()}
						>
							Start
						</Button>
					</div>
				</div>
			) : null}
			{rows.length > 0 || phase === "running" ? (
				<table className="mt-3 w-full text-left text-xs tabular-nums">
					<thead className="text-muted-foreground">
						<tr>
							<th className="py-1 font-medium">Runs on</th>
							<th className="py-1 font-medium">Load</th>
							<th className="py-1 font-medium">First sentence</th>
							<th className="py-1 font-medium">Speed</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.backend} className="border-t border-border">
								<td className="py-1.5">{LABEL[row.backend]}</td>
								{row.realtime === undefined ? (
									<td colSpan={3} className="py-1.5 text-muted-foreground">
										{row.note}
									</td>
								) : (
									<>
										<td className="py-1.5">{seconds(row.loadMs ?? 0)}</td>
										<td className="py-1.5">{seconds(row.firstMs ?? 0)}</td>
										<td className="py-1.5">{row.realtime.toFixed(1)}× realtime</td>
									</>
								)}
							</tr>
						))}
						{phase === "running" && candidates[rows.length] ? (
							<tr className="border-t border-border text-muted-foreground">
								<td className="py-1.5">{LABEL[candidates[rows.length]!.backend]}</td>
								<td colSpan={3} className="py-1.5">
									measuring…
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			) : null}
			<p role="status" className="sr-only">
				{phase === "running" && candidates[rows.length]
					? `Measuring ${LABEL[candidates[rows.length]!.backend]}`
					: phase === "done"
						? faster
							? `Speed test finished. ${LABEL[faster]} was fastest.`
							: "Speed test finished."
						: ""}
			</p>
			{faster ? (
				<div className="mt-3 flex items-center justify-between gap-4">
					<p className="text-xs text-muted-foreground">
						{LABEL[faster]} was fastest. Timings vary when the computer is busy.
					</p>
					<Button size="sm" onClick={() => onUse(faster)}>
						Use fastest
					</Button>
				</div>
			) : null}
		</div>
	);
}

/** "Test speed on this computer", offered when there are two options to compare. */
export function SpeedTest({ disk }: { disk: ModelsOnDisk | null }) {
	const config = useAppSettingsStore((s) => s.config);
	const webgpuAvailable = useAppSettingsStore((s) => s.webgpuAvailable);
	const engineId = useTtsStore((s) => s.engineId);
	if (!config || !disk) return null;
	const candidates = benchmarkCandidates(engineId, {
		webgpu: webgpuAvailable === true,
		backends: config.backends,
		fp32: disk.status.gpu.present,
		q8: disk.status.cpu.present,
		supertonic: disk.supertonic,
	});
	if (candidates.length < 2) return null;
	return <BackendBenchmark candidates={candidates} onUse={(b) => void applyBackend(b)} />;
}

/** Frees the disk space of the NVIDIA (CUDA) add-on, when it is installed. */
export function RemoveCudaAddon() {
	const installed = useAppSettingsStore((s) => s.config?.backends.cuda === "ready");
	const setConfig = useAppSettingsStore((s) => s.setConfig);
	if (!installed) return null;
	const remove = async () => {
		// Unload first (this also stops a running speed test): removing stops
		// the native engine, which may have the libraries loaded.
		resetTtsEngine();
		const next = await cudaAddonRemove();
		if (next) setConfig(next);
		resetTtsEngine();
	};
	return (
		<div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 p-4">
			<span className="text-sm font-medium">NVIDIA add-on</span>
			<Button variant="outline" size="sm" onClick={() => void remove()}>
				Remove NVIDIA add-on (frees about 330 MB)
			</Button>
		</div>
	);
}

/**
 * Settings → Voice → Advanced: where speech synthesis runs. "Automatic" keeps
 * the app's own order; the other entries are listed only where they can work.
 */
export function SpeechBackendControl({ disk }: { disk: ModelsOnDisk | null }) {
	const labelId = useId();
	const config = useAppSettingsStore((s) => s.config);
	const webgpuAvailable = useAppSettingsStore((s) => s.webgpuAvailable);
	const engineId = useTtsStore((s) => s.engineId);
	// Re-render when a model loads or unloads, for the "running on" line.
	useTtsStore((s) => s.modelPhase);
	const [addonOpen, setAddonOpen] = useState(false);

	if (!config) return null;
	const { backends } = config;
	const value = config.ttsBackend;
	const engine = getTtsEngine(engineId);

	if (!engine.runningOn) {
		return (
			<div className="rounded-lg border border-border bg-muted/20 p-4">
				<div className="text-sm font-medium">Run speech on</div>
				<p className="mt-2 text-xs text-muted-foreground">
					{engine.displayName} always runs on the processor.
				</p>
			</div>
		);
	}

	const onChange = (next: TtsBackend) => {
		if (next === "cuda" && backends.cuda !== "ready") setAddonOpen(true);
		else void applyBackend(next);
	};

	const options: { id: TtsBackend; show: boolean; hint?: string }[] = [
		{ id: "auto", show: true },
		{ id: "webgpu", show: webgpuAvailable === true },
		{
			id: "cuda",
			show: backends.cuda !== "unavailable",
			hint:
				backends.cuda === "needs-addon"
					? `${mb(config.cudaAddonBytes)} MB add-on`
					: undefined,
		},
		{ id: "dml", show: backends.dml },
		{ id: "cpu", show: backends.native },
		{
			id: "wasm",
			show: true,
			hint:
				engineId === "kokoro" && disk && !disk.status.cpu.present
					? `downloads ${mb(MODEL_BYTES.cpu)} MB on first use`
					: undefined,
		},
	];

	const running = engine.runningOn();
	const gpuChoice = value === "webgpu" || value === "cuda" || value === "dml";
	const note =
		engineId === "supertonic" && (value === "cuda" || value === "dml")
			? `${engine.displayName} can't use ${value === "cuda" ? "the NVIDIA add-on" : "DirectML"} yet; with this choice it runs on the processor.`
			: value === "auto"
				? "Uses the graphics card when there is one, otherwise the processor."
				: gpuChoice
					? "If this can't start, speech falls back to the processor and tells you."
					: null;

	return (
		<>
			<div className="rounded-lg border border-border bg-muted/20 p-4">
				<div id={labelId} className="mb-3 text-sm font-medium">
					Run speech on
				</div>
				<Select value={value} onValueChange={(v) => onChange(v as TtsBackend)}>
					<SelectTrigger className="w-full" aria-labelledby={labelId}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{options
							.filter((o) => o.show || o.id === value)
							.map((o) => (
								<SelectItem key={o.id} value={o.id}>
									{LABEL[o.id]}
									{o.hint ? ` · ${o.hint}` : ""}
								</SelectItem>
							))}
					</SelectContent>
				</Select>
				{config.ttsBackendChosen === "cuda" && value !== "cuda" ? (
					<p className="mt-3 text-xs text-amber-500">
						{LABEL.cuda} was selected, but it can&apos;t run right now
						{backends.cuda === "needs-addon"
							? `: its add-on needs to be downloaded again (app updates can require a new one). Pick ${LABEL.cuda} to download it.`
							: ": the CUDA 13 and cuDNN 9 libraries weren't found."}{" "}
						Using Automatic meanwhile.
					</p>
				) : null}
				{note ? <p className="mt-3 text-xs text-muted-foreground">{note}</p> : null}
				<p className="mt-1.5 text-xs text-muted-foreground">
					{running
						? `Now running on: ${RUNNING_LABEL[running]}.`
						: "The voice model loads on the next playback."}
				</p>
			</div>
			<CudaAddonDialog
				open={addonOpen}
				bytes={config.cudaAddonBytes}
				onClose={() => setAddonOpen(false)}
				onInstalled={() => {
					setAddonOpen(false);
					// Only now, with the verified add-on in place, is CUDA selected.
					void applyBackend("cuda");
				}}
			/>
		</>
	);
}
