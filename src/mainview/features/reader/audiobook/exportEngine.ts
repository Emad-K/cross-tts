import type { AudioFormat } from "@shared/audiobook";
import { sanitizeFileName, trackFileName } from "@shared/audiobook";
import {
	appendAudioFile,
	audioFileExists,
	finishAudioFile,
	getBookCoverBytes,
	getEpubChapterContent,
	writeAudioFile,
} from "@/lib/desktopBridge";
import { logError, logInfo } from "../logging";
import { getMaxChunkChars } from "../settings/appSettingsStore";
import {
	buildTtsChunks,
	ensureTtsLoaded,
	stopPlaybackUi,
	synthesizeChunkPcm,
	useTtsStore,
} from "../tts";
import { concat, createEncoder } from "./audioEncode";
import {
	type ChapterMark,
	createSingleFileEncoder,
	type SingleFileEncoder,
} from "./singleFileEncode";
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
	voice: string;
	speed: number;
	/** Write the whole book as one file instead of one file per chapter. */
	combine?: boolean;
	/** Book title, used to name the combined file. */
	bookTitle?: string;
};

/** ~16 MiB per IPC message keeps large single-file books off one giant payload. */
const WRITE_CHUNK_BYTES = 16 * 1024 * 1024;

/**
 * Write a (possibly large) file from ordered byte parts via the first-write +
 * append IPC pair, batching small parts and splitting big ones so no single
 * message (or temporary buffer) exceeds WRITE_CHUNK_BYTES.
 */
async function writeAudioFileChunked(
	dir: string,
	fileName: string,
	parts: Uint8Array[],
): Promise<void> {
	let first = true;
	const send = async (bytes: Uint8Array) => {
		const res = first
			? await writeAudioFile(dir, fileName, bytes)
			: await appendAudioFile(dir, fileName, bytes);
		first = false;
		if (!res.ok) throw new Error(res.error || "Couldn't write the file");
	};
	let batch: Uint8Array[] = [];
	let size = 0;
	for (const part of parts) {
		for (let off = 0; off < part.length; off += WRITE_CHUNK_BYTES) {
			const piece = part.subarray(off, off + WRITE_CHUNK_BYTES);
			if (size > 0 && size + piece.length > WRITE_CHUNK_BYTES) {
				await send(concat(batch));
				batch = [];
				size = 0;
			}
			batch.push(piece);
			size += piece.length;
		}
	}
	if (first || size > 0) await send(concat(batch));
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

	// Snapshot the playback pause setting once so the whole export is uniform.
	const sentencePauseMs = useTtsStore.getState().sentencePauseMs;

	try {
		await ensureTtsLoaded();

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

		const m4b = opts.format === "m4b";
		const single = m4b || !!opts.combine;
		let done = 0;
		const t0 = performance.now();
		// One encoder spanning the whole book when combining into a single file.
		let combinedEnc: ReturnType<typeof createEncoder> | null = null;
		// M4B path: AAC/MP4 (or MP3+ID3 fallback) with chapter markers + cover.
		let bookEnc: SingleFileEncoder | null = null;
		let bookSamples = 0;
		const chapterMarks: ChapterMark[] = [];

		for (let ci = 0; ci < items.length; ci++) {
			if (abort) break;
			const { title, chunks } = items[ci]!;
			useExportStore.setState({
				currentChapterIndex: ci,
				currentChapterTitle: title,
			});
			// M4B: mark the chapter at its first real audio — after the
			// inter-sentence gap, and never for chapters that produce no audio
			// (those would stack duplicate marks on the next chapter's start).
			let markPending = m4b;

			const trackName = trackFileName(ci + 1, title, opts.format);
			// Resume: a per-chapter file already on disk is a checkpoint — skip it.
			// (Single-file exports can't checkpoint mid-book, so don't skip there.)
			if (!single && (await audioFileExists(opts.dir, trackName))) {
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
					// Match playback's inter-sentence pause: silence before every
					// chunk except the first one written to an encoder.
					const gapSamples =
						sentencePauseMs > 0
							? new Float32Array(
									Math.round((pcm.sampleRate * sentencePauseMs) / 1000),
								)
							: null;
					if (m4b) {
						// Picks AAC/M4B when the platform can encode AAC, otherwise
						// a single MP3 with ID3 chapter frames.
						if (!bookEnc) {
							bookEnc = await createSingleFileEncoder(pcm.sampleRate);
						} else if (gapSamples) {
							// Gap counts into bookSamples so chapter marks stay accurate.
							bookEnc.append(gapSamples);
							bookSamples += gapSamples.length;
						}
						if (markPending) {
							chapterMarks.push({ title, startSample: bookSamples });
							markPending = false;
						}
						bookEnc.append(pcm.audio);
						bookSamples += pcm.audio.length;
					} else if (opts.combine) {
						if (!combinedEnc)
							combinedEnc = createEncoder(opts.format, pcm.sampleRate);
						else if (gapSamples) combinedEnc.append(gapSamples);
						combinedEnc.append(pcm.audio);
					} else {
						if (!enc) enc = createEncoder(opts.format, pcm.sampleRate);
						else if (gapSamples) enc.append(gapSamples);
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
			if (!single && enc) {
				// Resume treats any existing track file as done, so write to
				// `<name>.part` and only rename once the bytes are all on disk.
				// A crash mid-write leaves just a .part, redone on resume.
				const res = await writeAudioFile(
					opts.dir,
					`${trackName}.part`,
					concat(enc.finish()),
				);
				if (!res.ok) throw new Error(res.error || "Couldn't write the file");
				const fin = await finishAudioFile(opts.dir, trackName);
				if (!fin.ok) throw new Error(fin.error || "Couldn't write the file");
				useExportStore.setState({
					filesWritten: useExportStore.getState().filesWritten + 1,
				});
			}
		}

		if (!abort && single) {
			const base = sanitizeFileName(opts.bookTitle ?? "audiobook");
			if (bookEnc) {
				// Embed the full-size original cover (not the library thumbnail).
				const cover = await getBookCoverBytes(opts.filePath);
				const bytes = await bookEnc.finish({
					title: opts.bookTitle ?? "Audiobook",
					chapters: chapterMarks,
					cover,
				});
				await writeAudioFileChunked(opts.dir, `${base}.${bookEnc.ext}`, [bytes]);
				useExportStore.setState({ filesWritten: 1 });
			} else if (combinedEnc) {
				await writeAudioFileChunked(
					opts.dir,
					`${base}.${opts.format}`,
					combinedEnc.finish(),
				);
				useExportStore.setState({ filesWritten: 1 });
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
