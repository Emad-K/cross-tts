import { create } from "zustand";
import type { AudioFormat } from "@shared/audiobook";
import { trackFileName } from "@shared/audiobook";
import {
	getEpubChapterContent,
	writeAudioFile,
} from "@/lib/desktopBridge";
import { logError } from "../logging";
import {
	buildTtsChunks,
	ensureKokoroLoaded,
	type KokoroVoiceId,
	stopPlaybackUi,
	synthesizeChunkPcm,
} from "../tts";
import { createEncoder } from "./audioEncode";

export type ExportPhase =
	| "idle"
	| "preparing"
	| "running"
	| "paused"
	| "done"
	| "cancelled"
	| "error";

type ExportState = {
	phase: ExportPhase;
	totalChunks: number;
	doneChunks: number;
	totalChapters: number;
	currentChapterIndex: number;
	currentChapterTitle: string;
	etaSeconds: number | null;
	filesWritten: number;
	outputDir: string | null;
	error: string | null;
};

const INITIAL: ExportState = {
	phase: "idle",
	totalChunks: 0,
	doneChunks: 0,
	totalChapters: 0,
	currentChapterIndex: 0,
	currentChapterTitle: "",
	etaSeconds: null,
	filesWritten: 0,
	outputDir: null,
	error: null,
};

export const useExportStore = create<ExportState>(() => ({ ...INITIAL }));

// --- driver state (module-level, not in the store to avoid re-render churn) ---
let abort = false;
let paused = false;
let waiters: (() => void)[] = [];

function gate(): Promise<void> {
	if (!paused) return Promise.resolve();
	return new Promise<void>((resolve) => waiters.push(resolve));
}

function releaseWaiters(): void {
	const w = waiters;
	waiters = [];
	for (const f of w) f();
}

/** True while an export is preparing, running, or paused (blocks other actions). */
export function isExportActive(): boolean {
	const p = useExportStore.getState().phase;
	return p === "preparing" || p === "running" || p === "paused";
}

export function pauseExport(): void {
	if (useExportStore.getState().phase !== "running") return;
	paused = true;
	useExportStore.setState({ phase: "paused" });
}

export function resumeExport(): void {
	if (useExportStore.getState().phase !== "paused") return;
	paused = false;
	releaseWaiters();
	useExportStore.setState({ phase: "running" });
}

export function cancelExport(): void {
	if (!isExportActive()) return;
	abort = true;
	paused = false;
	releaseWaiters();
}

export function resetExport(): void {
	if (isExportActive()) return;
	useExportStore.setState({ ...INITIAL });
}

export type StartExportOpts = {
	filePath: string;
	chapters: { id: string; title: string }[];
	format: AudioFormat;
	dir: string;
	voice: KokoroVoiceId;
	speed: number;
};

export async function startExport(opts: StartExportOpts): Promise<void> {
	abort = false;
	paused = false;
	waiters = [];
	useExportStore.setState({
		...INITIAL,
		phase: "preparing",
		totalChapters: opts.chapters.length,
		outputDir: opts.dir,
	});
	stopPlaybackUi();

	try {
		await ensureKokoroLoaded();

		// Pre-pass: fetch every chapter's text and chunk it so we know the total
		// up front (accurate progress + ETA). No prefetch of audio — sequential.
		const items: { title: string; chunks: { text: string }[] }[] = [];
		let total = 0;
		for (const ch of opts.chapters) {
			if (abort) {
				useExportStore.setState({ phase: "cancelled" });
				return;
			}
			const content = await getEpubChapterContent(opts.filePath, ch.id);
			const chunks = buildTtsChunks(content?.text ?? "");
			items.push({ title: ch.title, chunks });
			total += chunks.length;
		}
		useExportStore.setState({ totalChunks: total, phase: "running" });

		let done = 0;
		const t0 = performance.now();
		for (let ci = 0; ci < items.length; ci++) {
			if (abort) break;
			const { title, chunks } = items[ci]!;
			useExportStore.setState({
				currentChapterIndex: ci,
				currentChapterTitle: title,
			});

			let enc: ReturnType<typeof createEncoder> | null = null;
			for (const chunk of chunks) {
				await gate();
				if (abort) break;
				const pcm = await synthesizeChunkPcm(chunk.text, opts.voice, opts.speed);
				if (pcm) {
					if (!enc) enc = createEncoder(opts.format, pcm.sampleRate);
					enc.append(pcm.audio);
				}
				done++;
				const elapsed = (performance.now() - t0) / 1000;
				const rate = done / Math.max(elapsed, 0.001);
				useExportStore.setState({
					doneChunks: done,
					etaSeconds: rate > 0 ? (total - done) / rate : null,
				});
			}
			if (abort) break;
			if (enc) {
				const bytes = enc.finish();
				const name = trackFileName(ci + 1, title, opts.format);
				const res = await writeAudioFile(opts.dir, name, bytes);
				if (!res.ok) throw new Error(res.error || "Couldn't write the file");
				useExportStore.setState({
					filesWritten: useExportStore.getState().filesWritten + 1,
				});
			}
		}

		useExportStore.setState(
			abort ? { phase: "cancelled" } : { phase: "done", etaSeconds: 0 },
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		logError("Audiobook export failed.", { source: "export", detail: msg });
		useExportStore.setState({ phase: "error", error: msg });
	}
}
