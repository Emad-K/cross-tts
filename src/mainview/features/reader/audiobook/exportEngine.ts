import type { AudioFormat } from "@shared/audiobook";
import { trackFileName } from "@shared/audiobook";
import {
	audioFileExists,
	getEpubChapterContent,
	writeAudioFile,
} from "@/lib/desktopBridge";
import { logError, logInfo } from "../logging";
import { getMaxChunkChars } from "../settings/appSettingsStore";
import {
	buildTtsChunks,
	ensureKokoroLoaded,
	type KokoroVoiceId,
	stopPlaybackUi,
	synthesizeChunkPcm,
} from "../tts";
import { createEncoder } from "./audioEncode";
import {
	INITIAL_EXPORT_STATE,
	isExportActive,
	useExportStore,
} from "./exportStore";

export { isExportActive, useExportStore } from "./exportStore";
export type { ExportPhase, ExportState } from "./exportStore";

const INITIAL = INITIAL_EXPORT_STATE;

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
	/** Write the whole book as one file instead of one file per chapter. */
	combine?: boolean;
	/** Book title, used to name the combined file. */
	bookTitle?: string;
};

function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "audiobook";
}

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
			const chunks = buildTtsChunks(content?.text ?? "", getMaxChunkChars());
			items.push({ title: ch.title, chunks });
			total += chunks.length;
		}
		useExportStore.setState({ totalChunks: total, phase: "running" });

		let done = 0;
		const t0 = performance.now();
		// One encoder spanning the whole book when combining into a single file.
		let combinedEnc: ReturnType<typeof createEncoder> | null = null;

		for (let ci = 0; ci < items.length; ci++) {
			if (abort) break;
			const { title, chunks } = items[ci]!;
			useExportStore.setState({
				currentChapterIndex: ci,
				currentChapterTitle: title,
			});

			const trackName = trackFileName(ci + 1, title, opts.format);
			// Resume: a per-chapter file already on disk is a checkpoint — skip it.
			// (Single-file exports can't checkpoint mid-book, so don't skip there.)
			if (!opts.combine && (await audioFileExists(opts.dir, trackName))) {
				done += chunks.length;
				useExportStore.setState((s) => ({
					doneChunks: done,
					skippedChapters: s.skippedChapters + 1,
				}));
				logInfo(`Skipping already-exported chapter: ${title}`, {
					source: "export",
				});
				continue;
			}

			let enc: ReturnType<typeof createEncoder> | null = null;
			for (const chunk of chunks) {
				await gate();
				if (abort) break;
				const pcm = await synthesizeChunkPcm(chunk.text, opts.voice, opts.speed);
				if (pcm) {
					if (opts.combine) {
						if (!combinedEnc)
							combinedEnc = createEncoder(opts.format, pcm.sampleRate);
						combinedEnc.append(pcm.audio);
					} else {
						if (!enc) enc = createEncoder(opts.format, pcm.sampleRate);
						enc.append(pcm.audio);
					}
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
			if (!opts.combine && enc) {
				const bytes = enc.finish();
				const res = await writeAudioFile(opts.dir, trackName, bytes);
				if (!res.ok) throw new Error(res.error || "Couldn't write the file");
				useExportStore.setState({
					filesWritten: useExportStore.getState().filesWritten + 1,
				});
			}
		}

		if (!abort && opts.combine && combinedEnc) {
			const bytes = combinedEnc.finish();
			const name = `${sanitizeFileName(opts.bookTitle ?? "audiobook")}.${opts.format}`;
			const res = await writeAudioFile(opts.dir, name, bytes);
			if (!res.ok) throw new Error(res.error || "Couldn't write the file");
			useExportStore.setState({ filesWritten: 1 });
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
