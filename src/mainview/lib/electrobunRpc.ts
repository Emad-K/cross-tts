import { Electroview } from "electrobun/view";
import type { AppRpcSchema } from "@shared/appRpc";
import type {
	EpubChapterContentResult,
	ReadDocumentResult,
} from "@shared/documentRpc";
import type { AppSessionFileV1, WebPersistedSlice } from "@shared/appSession";

/**
 * Read globals each time — Electrobun injects `__electrobunWebviewId` /
 * `__electrobunRpcSocketPort` after (or as) scripts run; a one-time module read
 * stays false and hides the custom title bar + skips Electroview boot.
 */
export function isElectrobunWebview(): boolean {
	if (typeof window === "undefined") return false;
	return (
		typeof window.__electrobunWebviewId === "number" &&
		typeof window.__electrobunRpcSocketPort === "number"
	);
}

let rpc: ReturnType<typeof Electroview.defineRPC<AppRpcSchema>> | null = null;
let electroviewStarted = false;

function ensureElectroview(): ReturnType<
	typeof Electroview.defineRPC<AppRpcSchema>
> | null {
	if (!isElectrobunWebview()) return null;
	if (!rpc) {
		rpc = Electroview.defineRPC<AppRpcSchema>({
			maxRequestTime: 120_000,
			handlers: { requests: {}, messages: {} },
		});
	}
	if (!electroviewStarted) {
		electroviewStarted = true;
		new Electroview({ rpc });
	}
	return rpc;
}

export function bootElectrobunMainView(): void {
	ensureElectroview();
}

export function requestCloseWindow(): void {
	ensureElectroview()?.send.closeWindow();
}

export function requestMinimizeWindow(): void {
	ensureElectroview()?.send.minimizeWindow();
}

export function requestToggleMaximize(): void {
	ensureElectroview()?.send.maximizeWindow();
}

export async function getKokoroHubBaseUrl(): Promise<string | null> {
	const r = ensureElectroview();
	if (!r) return null;
	return r.request.getKokoroHubBaseUrl();
}

export async function loadAppSession(): Promise<AppSessionFileV1 | null> {
	const r = ensureElectroview();
	if (!r) return null;
	return r.request.loadAppSession();
}

export async function saveAppSession(web: WebPersistedSlice): Promise<void> {
	const r = ensureElectroview();
	if (!r) return;
	await r.request.saveAppSession(web);
}

export async function pickDocument(): Promise<ReadDocumentResult | null> {
	const r = ensureElectroview();
	if (!r) return null;
	return r.request.pickDocument();
}

export async function readDocumentAtPath(
	filePath: string,
): Promise<ReadDocumentResult | null> {
	const r = ensureElectroview();
	if (!r) return null;
	return r.request.readDocumentAtPath({ filePath });
}

export async function getEpubChapterContent(
	filePath: string,
	chapterId: string,
): Promise<EpubChapterContentResult | null> {
	const r = ensureElectroview();
	if (!r) return null;
	return r.request.getEpubChapterContent({ filePath, chapterId });
}

export async function exportTtsRulesToFile(
	json: string,
	suggestedFileName: string,
): Promise<{ cancelled: boolean; filePath: string | null }> {
	const r = ensureElectroview();
	if (!r) return { cancelled: true, filePath: null };
	return r.request.exportTtsRulesToFile({ json, suggestedFileName });
}

/** @deprecated Use pickDocument */
export async function pickTextDocument(): Promise<Extract<
	ReadDocumentResult,
	{ format: "txt" }
> | null> {
	const r = ensureElectroview();
	if (!r) return null;
	return r.request.pickTextDocument();
}

/** @deprecated Use readDocumentAtPath */
export async function readTextDocumentAtPath(
	filePath: string,
): Promise<Extract<ReadDocumentResult, { format: "txt" }> | null> {
	const r = ensureElectroview();
	if (!r) return null;
	return r.request.readTextDocumentAtPath({ filePath });
}
