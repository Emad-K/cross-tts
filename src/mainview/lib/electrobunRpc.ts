import { Electroview } from "electrobun/view";
import type { AppRpcSchema, ReadTextDocumentResult } from "@shared/appRpc";
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
			// Default 1s is too short for native file dialogs while the user browses.
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

/** Start Electroview + RPC when embedded in Electrobun (needed for draggable title bar). */
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

export async function pickTextDocument(): Promise<ReadTextDocumentResult | null> {
	const r = ensureElectroview();
	if (!r) return null;
	return r.request.pickTextDocument();
}

export async function readTextDocumentAtPath(
	filePath: string,
): Promise<ReadTextDocumentResult | null> {
	const r = ensureElectroview();
	if (!r) return null;
	return r.request.readTextDocumentAtPath({ filePath });
}
