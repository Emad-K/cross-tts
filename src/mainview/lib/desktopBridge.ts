import type {
	AppApi,
	CudaAddonInstallResult,
	FoundInPageResult,
} from "@shared/appRpc";
import type {
	TtsNodeEngine,
	TtsNodeEp,
	TtsNodeGenerateParams,
	TtsNodeGenerateResult,
	TtsNodeInitResult,
} from "@shared/ttsNodeRpc";
import type {
	AppConfigInfo,
	GpuPowerPreference,
	TtsBackend,
} from "@shared/appConfig";
import type { Appearance } from "@shared/appearance";
import type { ForwardedLogEntry } from "@shared/logEntry";
import type {
	ModelKind,
	ModelProgress,
	ModelStatusMap,
} from "@shared/modelAssets";
import type { ShortcutAction } from "@shared/shortcuts";
import type {
	EpubChapterContentResult,
	ReadDocumentResult,
} from "@shared/documentRpc";
import type { AppSessionFileV1, WebPersistedSlice } from "@shared/appSession";
import type { UpdateStatus } from "@shared/updateStatus";
import type { WatchedFileCandidate } from "@shared/watchedFolders";
import type { CrashRecord } from "@shared/crashReport";

/**
 * Typed bridge to the Electron main process. The preload script exposes the
 * RPC surface on `window.api` (see `src/preload/index.ts`). In a plain browser
 * (e.g. Vite served without Electron) the bridge is absent, so callers fall
 * back to web behavior.
 */
function bridge(): AppApi | null {
	if (typeof window === "undefined") return null;
	return window.api ?? null;
}

/** True when running inside the Electron desktop app (preload bridge present). */
export function isDesktopApp(): boolean {
	return bridge() !== null;
}

export async function getKokoroHubBaseUrl(): Promise<string | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.getKokoroHubBaseUrl();
}

export async function loadAppSession(): Promise<AppSessionFileV1 | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.loadAppSession();
}

export async function saveAppSession(web: WebPersistedSlice): Promise<void> {
	const b = bridge();
	if (!b) return;
	await b.request.saveAppSession(web);
}

export async function pickDocument(): Promise<ReadDocumentResult | null> {
	const b = bridge();
	if (!b) return null;
	return finishPdf(await b.request.pickDocument());
}

/**
 * The main process doesn't parse PDFs: it returns a book with no chapters and
 * the renderer's pdf.js (in a Web Worker) fills them in. Loaded on demand.
 */
async function finishPdf(
	result: ReadDocumentResult | null,
): Promise<ReadDocumentResult | null> {
	if (result?.format !== "epub" || result.source !== "pdf") return result;
	const { openPdf } = await import("@/features/reader/pdf/pdfDocument");
	return openPdf(result);
}

/** Absolute OS path of a dropped/picked File, or null on web / unknown path. */
export function pathForFile(file: File): string | null {
	const b = bridge();
	if (!b) return null;
	const path = b.getPathForFile(file);
	return path.length > 0 ? path : null;
}

/** Message of an error thrown in a main-process IPC handler, minus Electron's prefix. */
export function ipcErrorMessage(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}

/**
 * Read a document. `peek` skips parsing a PDF (its chapter list comes back
 * empty): for callers that only need to know the file is there and its title.
 */
export async function readDocumentAtPath(
	filePath: string,
	options?: { peek?: boolean },
): Promise<ReadDocumentResult | null> {
	const b = bridge();
	if (!b) return null;
	const result = await b.request.readDocumentAtPath({ filePath });
	return options?.peek ? result : finishPdf(result);
}

export async function getEpubChapterContent(
	filePath: string,
	chapterId: string,
): Promise<EpubChapterContentResult | null> {
	const b = bridge();
	if (!b) return null;
	if (filePath.toLowerCase().endsWith(".pdf")) {
		const { pdfChapter } = await import("@/features/reader/pdf/pdfDocument");
		return pdfChapter(filePath, chapterId);
	}
	return b.request.getEpubChapterContent({ filePath, chapterId });
}

export async function exportTtsRulesToFile(
	json: string,
	suggestedFileName: string,
): Promise<{ cancelled: boolean; filePath: string | null }> {
	const b = bridge();
	if (!b) return { cancelled: true, filePath: null };
	return b.request.exportTtsRulesToFile({ json, suggestedFileName });
}

export async function getAppConfig(): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.getAppConfig();
}

export async function setTtsBackend(
	backend: TtsBackend,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setTtsBackend({ backend });
}

/** Download the CUDA add-on (234 MB, from nuget.org). Null on web. */
export async function cudaAddonInstall(): Promise<CudaAddonInstallResult | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.cudaAddonInstall();
}

export async function cudaAddonCancel(): Promise<void> {
	await bridge()?.request.cudaAddonCancel();
}

export async function cudaAddonRemove(): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.cudaAddonRemove();
}

export function onCudaAddonProgress(
	listener: (progress: { loaded: number; total: number }) => void,
): () => void {
	const b = bridge();
	if (!b?.onCudaAddonProgress) return () => {};
	return b.onCudaAddonProgress(listener);
}

export async function setGpuPower(
	power: GpuPowerPreference,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setGpuPower({ power });
}

export async function setAppearance(
	patch: Partial<Appearance>,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setAppearance(patch);
}

export async function chooseExportFolder(): Promise<string | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.chooseExportFolder();
}

export async function writeAudioFile(
	dir: string,
	fileName: string,
	data: Uint8Array,
): Promise<{ ok: boolean; path: string | null; error?: string }> {
	const b = bridge();
	if (!b) return { ok: false, path: null, error: "Not in desktop app" };
	return b.request.writeAudioFile({ dir, fileName, data });
}

export async function appendAudioFile(
	dir: string,
	fileName: string,
	data: Uint8Array,
): Promise<{ ok: boolean; path: string | null; error?: string }> {
	const b = bridge();
	if (!b) return { ok: false, path: null, error: "Not in desktop app" };
	return b.request.appendAudioFile({ dir, fileName, data });
}

export async function finishAudioFile(
	dir: string,
	fileName: string,
): Promise<{ ok: boolean; path: string | null; error?: string }> {
	const b = bridge();
	if (!b) return { ok: false, path: null, error: "Not in desktop app" };
	return b.request.finishAudioFile({ dir, fileName });
}

export async function audioFileExists(
	dir: string,
	fileName: string,
): Promise<boolean> {
	const b = bridge();
	if (!b) return false;
	return b.request.audioFileExists({ dir, fileName });
}

export async function getBookCover(filePath: string): Promise<string | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.getBookCover({ filePath });
}

export async function getBookCoverBytes(
	filePath: string,
): Promise<{ data: Uint8Array; mime: string } | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.getBookCoverBytes({ filePath });
}

export async function revealPath(path: string): Promise<void> {
	const b = bridge();
	if (!b) return;
	await b.request.revealPath({ path });
}

/** Open an https URL in the default browser (web fallback: new tab). */
export async function openExternal(url: string): Promise<void> {
	const b = bridge();
	if (!b) {
		window.open(url, "_blank", "noopener,noreferrer");
		return;
	}
	await b.request.openExternal({ url });
}

export async function getGpuInfo(): Promise<{
	activeRenderer: string;
	gpus: string[];
}> {
	const b = bridge();
	if (!b) return { activeRenderer: "", gpus: [] };
	return b.request.getGpuInfo();
}

/** Whether Supertonic 3's model is on disk. False on web. */
export async function supertonicPresent(): Promise<boolean> {
	return (await bridge()?.request.supertonicPresent()) ?? false;
}

export async function getModelStatus(): Promise<ModelStatusMap | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.getModelStatus();
}

export async function downloadModel(
	kind: ModelKind,
): Promise<ModelStatusMap | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.downloadModel({ kind });
}

export async function removeModel(
	kind: ModelKind,
): Promise<ModelStatusMap | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.removeModel({ kind });
}

export async function setCrashPromptDisabled(
	disabled: boolean,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setCrashPromptDisabled({ disabled });
}

/** Subscribe to model-download progress. No-op (noop unsubscribe) on web. */
export function subscribeToModelProgress(
	listener: (progress: ModelProgress) => void,
): () => void {
	const b = bridge();
	if (!b?.onModelProgress) return () => {};
	return b.onModelProgress(listener);
}

export async function setCpuThreads(
	threads: number,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setCpuThreads({ threads });
}

export async function setGpuFp16(
	enabled: boolean,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setGpuFp16({ enabled });
}

export async function setShortcutsEnabled(
	enabled: boolean,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setShortcutsEnabled({ enabled });
}

export async function setAutoUpdate(
	enabled: boolean,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setAutoUpdate({ enabled });
}

export async function setShortcutBinding(
	action: ShortcutAction,
	accelerator: string,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setShortcutBinding({ action, accelerator });
}

/** Subscribe to global-shortcut triggers. No-op (noop unsubscribe) on web. */
export function subscribeToShortcuts(
	listener: (action: ShortcutAction) => void,
): () => void {
	const b = bridge();
	if (!b?.onShortcut) return () => {};
	return b.onShortcut(listener);
}

export function findInPage(
	text: string,
	opts?: { forward?: boolean; findNext?: boolean },
): void {
	const b = bridge();
	if (!b) return;
	void b.request.findInPage({ text, ...opts });
}

export function stopFindInPage(): void {
	const b = bridge();
	if (!b) return;
	void b.request.stopFindInPage();
}

/** Subscribe to in-page find results. No-op (noop unsubscribe) on web. */
export function subscribeFoundInPage(
	listener: (result: FoundInPageResult) => void,
): () => void {
	const b = bridge();
	if (!b?.onFoundInPage) return () => {};
	return b.onFoundInPage(listener);
}

export async function chooseDataDirectory(): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.chooseDataDirectory();
}

export async function resetDataDirectory(): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.resetDataDirectory();
}

export async function revealDataDirectory(): Promise<void> {
	const b = bridge();
	if (!b) return;
	await b.request.revealDataDirectory();
}

export async function relaunchApp(): Promise<void> {
	const b = bridge();
	if (!b) return;
	await b.request.relaunchApp();
}

/** Subscribe to main-process log entries. No-op (returns noop unsubscribe) on web. */
/** Manually check for updates; null on web. */
export async function checkForUpdates(): Promise<UpdateStatus | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.checkForUpdates();
}

/** Current update state; null on web. */
export async function getUpdateStatus(): Promise<UpdateStatus | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.getUpdateStatus();
}

/** Restart into a downloaded update. */
export async function quitAndInstallUpdate(): Promise<void> {
	const b = bridge();
	if (!b) return;
	await b.request.quitAndInstallUpdate();
}

export function subscribeToUpdateStatus(
	listener: (status: UpdateStatus) => void,
): () => void {
	const b = bridge();
	if (!b?.onUpdateStatus) return () => {};
	return b.onUpdateStatus(listener);
}

export function subscribeToMainProcessLogs(
	listener: (entry: ForwardedLogEntry) => void,
): () => void {
	const b = bridge();
	if (!b?.onLog) return () => {};
	return b.onLog(listener);
}

/** Pick a folder to watch for new books; null on cancel / web. */
export async function addWatchedFolder(): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.addWatchedFolder();
}

/** Stop watching a folder; null on web. */
export async function removeWatchedFolder(
	dir: string,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.removeWatchedFolder({ dir });
}

/** Scan watched folders now; empty on web. */
export async function getWatchedFileCandidates(): Promise<
	WatchedFileCandidate[]
> {
	const b = bridge();
	if (!b) return [];
	return b.request.getWatchedFileCandidates();
}

/** Subscribe to watched-folder scan snapshots. No-op (noop unsubscribe) on web. */
export function subscribeToWatchedFiles(
	listener: (candidates: WatchedFileCandidate[]) => void,
): () => void {
	const b = bridge();
	if (!b?.onWatchedFiles) return () => {};
	return b.onWatchedFiles(listener);
}

/** Unreported crashes from previous runs; empty on web or when opted out. */
export async function getPendingCrashReports(): Promise<CrashRecord[]> {
	const b = bridge();
	if (!b) return [];
	return b.request.getPendingCrashReports();
}

/** Report (opens a prefilled GitHub issue) or dismiss the stored crashes. */
export async function resolveCrashReports(params: {
	action: "report" | "dismiss";
	dontAskAgain: boolean;
}): Promise<void> {
	const b = bridge();
	if (!b) return;
	await b.request.resolveCrashReports(params);
}

/** Subscribe to crash reports pushed on launch. No-op on web. */
export function subscribeToCrashReports(
	listener: (records: CrashRecord[]) => void,
): () => void {
	const b = bridge();
	if (!b?.onCrashReports) return () => {};
	return b.onCrashReports(listener);
}

/**
 * Start the native (onnxruntime-node) TTS backend on execution provider `ep`
 * (the CPU when it can't run here). Null on web (no bridge).
 */
export async function ttsNodeInit(
	engine: TtsNodeEngine = "kokoro",
	ep: TtsNodeEp = "cpu",
): Promise<TtsNodeInitResult | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.ttsNodeInit({ engine, ep });
}

/** Synthesize one chunk on the native CPU backend. Null on web (no bridge). */
export async function ttsNodeGenerate(
	params: TtsNodeGenerateParams,
): Promise<TtsNodeGenerateResult | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.ttsNodeGenerate(params);
}

/** Stop the native CPU TTS backend if it serves `engine`. No-op on web. */
export async function ttsNodeStop(engine: TtsNodeEngine = "kokoro"): Promise<void> {
	const b = bridge();
	if (!b) return;
	await b.request.ttsNodeStop(engine);
}

/** Subscribe to native-TTS model-load progress (0..1). No-op on web. */
export function onTtsNodeProgress(listener: (value: number) => void): () => void {
	const b = bridge();
	if (!b?.onTtsNodeProgress) return () => {};
	return b.onTtsNodeProgress(listener);
}
