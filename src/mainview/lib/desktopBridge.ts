import type { AppApi, FoundInPageResult } from "@shared/appRpc";
import type { AppConfigInfo, GpuPowerPreference } from "@shared/appConfig";
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
	return b.request.pickDocument();
}

/** Absolute OS path of a dropped/picked File, or null on web / unknown path. */
export function pathForFile(file: File): string | null {
	const b = bridge();
	if (!b) return null;
	const path = b.getPathForFile(file);
	return path.length > 0 ? path : null;
}

export async function readDocumentAtPath(
	filePath: string,
): Promise<ReadDocumentResult | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.readDocumentAtPath({ filePath });
}

export async function getEpubChapterContent(
	filePath: string,
	chapterId: string,
): Promise<EpubChapterContentResult | null> {
	const b = bridge();
	if (!b) return null;
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

export async function setGpuEnabled(
	enabled: boolean,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setGpuEnabled({ enabled });
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

export async function revealPath(path: string): Promise<void> {
	const b = bridge();
	if (!b) return;
	await b.request.revealPath({ path });
}

export async function getGpuInfo(): Promise<{
	activeRenderer: string;
	gpus: string[];
}> {
	const b = bridge();
	if (!b) return { activeRenderer: "", gpus: [] };
	return b.request.getGpuInfo();
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
export function subscribeToMainProcessLogs(
	listener: (entry: ForwardedLogEntry) => void,
): () => void {
	const b = bridge();
	if (!b?.onLog) return () => {};
	return b.onLog(listener);
}
