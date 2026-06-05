import type { AppApi } from "@shared/appRpc";
import type { AppConfigInfo } from "@shared/appConfig";
import type { ForwardedLogEntry } from "@shared/logEntry";
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

export async function setCpuThreads(
	threads: number,
): Promise<AppConfigInfo | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.setCpuThreads({ threads });
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
