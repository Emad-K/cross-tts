import { Cpu, Gauge, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TtsBackend } from "@shared/appConfig";
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
	getModelStatus,
	onCudaAddonProgress,
	supertonicPresent,
} from "@/lib/desktopBridge";
import { isExportPhaseActive, useExportStore } from "../audiobook/exportStore";
import { getTtsEngine, resetTtsEngine, useTtsStore } from "../tts";
import type { RunningBackend } from "../tts/backendChoice";
import {
	type BenchmarkCandidate,
	type BenchmarkRow,
	benchmarkCandidates,
	fasterChoice,
	runBenchmark,
} from "../tts/benchmark";
import { effectiveCpuThreads, useAppSettingsStore } from "./appSettingsStore";

const LABEL: Record<TtsBackend, string> = {
	auto: "Auto (recommended)",
	webgpu: "GPU (WebGPU)",
	cuda: "NVIDIA GPU (CUDA)",
	dml: "GPU (DirectML, experimental)",
	cpu: "CPU (native)",
	wasm: "CPU (WASM, compatibility)",
};

const mb = (bytes: number) => Math.round(bytes / 1_048_576);

/** Which model files are on disk; null until the main process answered. */
type ModelsOnDisk = { fp32: boolean; q8: boolean; supertonic: boolean };

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
				<DialogTitle>Download the NVIDIA CUDA add-on?</DialogTitle>
				<DialogDescription>
					Speech on NVIDIA CUDA needs ONNX Runtime&apos;s CUDA libraries, which
					are too large to ship with the app. This is a one-time {mb(bytes)} MB
					download from nuget.org (about 330 MB on disk), checked against a
					known checksum before it is used.
					{movedDataDir
						? " It is stored in the app's settings folder on the system drive, not in the data folder you chose."
						: ""}
				</DialogDescription>
				<p className="text-xs text-muted-foreground">
					The amount of GPU memory CUDA uses can&apos;t be capped. If it
					can&apos;t start or runs out of memory, speech continues on the CPU.
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

	const faster =
		phase === "done" && config ? fasterChoice(engineId, config.ttsBackend, rows) : null;

	return (
		<div className="mt-3 rounded-lg border border-border bg-muted/20 p-4">
			<div className="flex items-center justify-between gap-4">
				<span className="flex items-center gap-2 text-sm font-medium">
					<Gauge className="size-4 text-muted-foreground" aria-hidden />
					Benchmark
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
						{phase === "done" ? "Run again" : "Run benchmark"}
					</Button>
				) : null}
			</div>
			<p className="mt-3 text-xs text-muted-foreground">
				{blocked && phase !== "running"
					? exporting
						? "Wait for the audiobook export to finish first."
						: "Pause playback first."
					: "Times one sentence on each backend this computer has, so you can pick the fastest. It only runs when you start it."}
			</p>
			{phase === "confirm" ? (
				<div className="mt-3 rounded-md border border-border p-3">
					<p className="text-xs">
						This loads the voice model on each backend in turn and reads one
						sentence twice. It briefly uses the GPU, unloads the current model
						and stops paused playback at its sentence. No voice model is
						downloaded for it.
					</p>
					<div className="mt-3 flex justify-end gap-2">
						<Button variant="outline" size="sm" onClick={() => setPhase("idle")}>
							Not now
						</Button>
						<Button size="sm" disabled={blocked} onClick={() => void start()}>
							Start
						</Button>
					</div>
				</div>
			) : null}
			{rows.length > 0 || phase === "running" ? (
				<table className="mt-3 w-full text-left text-xs tabular-nums">
					<thead className="text-muted-foreground">
						<tr>
							<th className="py-1 font-medium">Backend</th>
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
							? `Benchmark finished. ${LABEL[faster]} was fastest.`
							: "Benchmark finished."
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

/**
 * Settings → Performance: where speech synthesis runs. "Auto" keeps the
 * app's own order; the other entries are listed only where they can work.
 */
export function SpeechBackendControl() {
	const config = useAppSettingsStore((s) => s.config);
	const webgpuAvailable = useAppSettingsStore((s) => s.webgpuAvailable);
	const setTtsBackend = useAppSettingsStore((s) => s.setTtsBackend);
	const setConfig = useAppSettingsStore((s) => s.setConfig);
	const engineId = useTtsStore((s) => s.engineId);
	// Re-render when a model loads or unloads, for the "running on" line.
	useTtsStore((s) => s.modelPhase);
	const [models, setModels] = useState<ModelsOnDisk | null>(null);
	const [addonOpen, setAddonOpen] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void Promise.all([getModelStatus(), supertonicPresent()]).then(
			([status, supertonic]) => {
				if (cancelled || !status) return;
				setModels({ fp32: status.gpu.present, q8: status.cpu.present, supertonic });
			},
		);
		return () => {
			cancelled = true;
		};
	}, []);

	if (!config) return null;
	const { backends } = config;
	const value = config.ttsBackend;
	const cudaMb = mb(config.cudaAddonBytes);

	const apply = async (backend: TtsBackend) => {
		await setTtsBackend(backend);
		// Backends use different model weights and processes: drop the loaded
		// model so the next play loads the chosen one.
		resetTtsEngine();
	};

	const onChange = (next: TtsBackend) => {
		if (next === "cuda" && backends.cuda !== "ready") setAddonOpen(true);
		else void apply(next);
	};

	const removeAddon = async () => {
		// Unload first (this also stops a running benchmark): removing stops
		// the native engine, which may have the libraries loaded.
		resetTtsEngine();
		const next = await cudaAddonRemove();
		if (next) setConfig(next);
		resetTtsEngine();
	};

	const options: { id: TtsBackend; show: boolean; hint?: string }[] = [
		{ id: "auto", show: true },
		{ id: "webgpu", show: webgpuAvailable === true },
		{
			id: "cuda",
			show: backends.cuda !== "unavailable",
			hint: backends.cuda === "needs-addon" ? `${cudaMb} MB add-on` : undefined,
		},
		{ id: "dml", show: backends.dml },
		{ id: "cpu", show: backends.native },
		{
			id: "wasm",
			show: true,
			hint:
				engineId === "kokoro" && models && !models.q8
					? "downloads 88 MB on first use"
					: undefined,
		},
	];

	const engine = getTtsEngine(engineId);
	const running = engine.runningOn?.() ?? null;
	const gpuChoice = value === "webgpu" || value === "cuda" || value === "dml";
	const note = !engine.runningOn
		? `${engine.displayName} always runs on the CPU (WASM); this setting applies to the other voice engines.`
		: engineId === "supertonic" && (value === "cuda" || value === "dml")
			? `Supertonic 3 doesn't use ${value === "cuda" ? "CUDA" : "DirectML"} yet; with this choice it runs on the CPU (native).`
			: value === "auto"
				? "Uses the GPU through WebGPU when there is one, otherwise the CPU."
				: gpuChoice
					? "If this backend can't start, speech falls back to the CPU and tells you."
					: null;

	const candidates = benchmarkCandidates(engineId, {
		webgpu: webgpuAvailable === true,
		backends,
		fp32: models?.fp32 ?? false,
		q8: models?.q8 ?? false,
		supertonic: models?.supertonic ?? false,
	});

	return (
		<>
			<div className="rounded-lg border border-border bg-muted/20 p-4">
				<div className="mb-3 flex items-center gap-2 text-sm font-medium">
					{value === "cpu" || value === "wasm" ? (
						<Cpu className="size-4 text-muted-foreground" aria-hidden />
					) : (
						<Zap className="size-4 text-amber-400" aria-hidden />
					)}
					Speech backend
				</div>
				<Select value={value} onValueChange={(v) => onChange(v as TtsBackend)}>
					<SelectTrigger className="w-full" aria-label="Speech backend">
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
						NVIDIA CUDA was selected, but it can&apos;t run right now
						{backends.cuda === "needs-addon"
							? ": its add-on needs to be downloaded again (app updates can require a new one). Pick NVIDIA GPU (CUDA) to download it."
							: ": the CUDA 13 and cuDNN 9 libraries weren't found."}{" "}
						Using Auto meanwhile.
					</p>
				) : null}
				{note ? <p className="mt-3 text-xs text-muted-foreground">{note}</p> : null}
				{engine.runningOn ? (
					<p className="mt-1.5 text-xs text-muted-foreground">
						{running
							? `Now running on: ${LABEL[running]}.`
							: "The voice model loads on the next playback."}
					</p>
				) : null}
				{backends.cuda === "ready" ? (
					<Button
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => void removeAddon()}
					>
						Remove CUDA add-on (frees about 330 MB)
					</Button>
				) : null}
			</div>
			{candidates.length >= 2 && models ? (
				<BackendBenchmark candidates={candidates} onUse={(b) => void apply(b)} />
			) : null}
			<CudaAddonDialog
				open={addonOpen}
				bytes={config.cudaAddonBytes}
				onClose={() => setAddonOpen(false)}
				onInstalled={() => {
					setAddonOpen(false);
					// Only now, with the verified add-on in place, is CUDA selected.
					void apply("cuda");
				}}
			/>
		</>
	);
}
