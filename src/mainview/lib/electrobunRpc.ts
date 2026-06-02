import type { AppApi } from "@shared/appRpc";
import type {
	EpubChapterContentResult,
	ReadDocumentResult,
} from "@shared/documentRpc";
import type { AppSessionFileV1, WebPersistedSlice } from "@shared/appSession";

/**
 * The Electron preload script exposes the typed RPC bridge on `window.api`
 * (see `src/preload/index.ts`). In a plain browser (e.g. Vite served without
 * Electron) the bridge is absent, so callers fall back to web behavior.
 *
 * Exported function names are kept stable across the Electrobun → Electron
 * migration so no UI call sites needed to change.
 */
function bridge(): AppApi | null {
	if (typeof window === "undefined") return null;
	return window.api ?? null;
}

/** True when running inside the Electron app (preload bridge present). */
export function isElectrobunWebview(): boolean {
	return bridge() !== null;
}

/** No-op under Electron — the preload bridge is injected before scripts run. */
export function bootElectrobunMainView(): void {
	// Intentionally empty. Retained for call-site compatibility.
}

export function requestCloseWindow(): void {
	bridge()?.send.closeWindow();
}

export function requestMinimizeWindow(): void {
	bridge()?.send.minimizeWindow();
}

export function requestToggleMaximize(): void {
	bridge()?.send.maximizeWindow();
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

/** @deprecated Use pickDocument */
export async function pickTextDocument(): Promise<Extract<
	ReadDocumentResult,
	{ format: "txt" }
> | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.pickTextDocument();
}

/** @deprecated Use readDocumentAtPath */
export async function readTextDocumentAtPath(
	filePath: string,
): Promise<Extract<ReadDocumentResult, { format: "txt" }> | null> {
	const b = bridge();
	if (!b) return null;
	return b.request.readTextDocumentAtPath({ filePath });
}
