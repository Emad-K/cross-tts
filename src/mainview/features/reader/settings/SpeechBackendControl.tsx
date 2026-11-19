import { Cpu, Zap } from "lucide-react";
import { useEffect, useState } from "react";
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
import { getTtsEngine, resetTtsEngine, useTtsStore } from "../tts";
import { useAppSettingsStore } from "./appSettingsStore";

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
 * "Download" is clicked; closing the dialog cancels a download in progress.
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
			<DialogContent className="max-w-md">
				<DialogTitle>Download the NVIDIA CUDA add-on?</DialogTitle>
				<DialogDescription>
					Speech on NVIDIA CUDA needs ONNX Runtime&apos;s CUDA libraries, which
					are too large to ship with the app. This is a one-time {mb(bytes)} MB
					download from nuget.org (about 330 MB on disk), checked against a
					known checksum before it is used.
				</DialogDescription>
				<p className="text-xs text-muted-foreground">
					The amount of GPU memory CUDA uses can&apos;t be capped. If it
					can&apos;t start or runs out of memory, speech continues on the CPU.
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
