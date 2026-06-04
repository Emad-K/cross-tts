import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	APP_SESSION_VERSION,
	type AppSessionFileV1,
	type StoredWindowFrame,
	type WebPersistedSlice,
	defaultWebPersistedSlice,
} from "../shared/appSession";
import { coerceTtsTextRulesState } from "../shared/ttsTextRules";
import { dataDir } from "./appConfigStore";

const SESSION_NAME = "app-session.json";

export function appSessionPath(): string {
	return join(dataDir(), SESSION_NAME);
}

function isSaneFrame(f: StoredWindowFrame): boolean {
	return (
		Number.isFinite(f.x) &&
		Number.isFinite(f.y) &&
		Number.isFinite(f.width) &&
		Number.isFinite(f.height) &&
		f.width >= 400 &&
		f.width <= 16_000 &&
		f.height >= 300 &&
		f.height <= 16_000
	);
}

function coerceWeb(raw: unknown): WebPersistedSlice {
	const d = defaultWebPersistedSlice();
	if (!raw || typeof raw !== "object") return d;
	const o = raw as Record<string, unknown>;
	if (typeof o.voice === "string") d.voice = o.voice;
	if (typeof o.volumePct === "number" && o.volumePct >= 0 && o.volumePct <= 100) {
		d.volumePct = Math.round(o.volumePct);
	}
	if (typeof o.speed === "number" && o.speed >= 0.5 && o.speed <= 2) {
		d.speed = o.speed;
	}
	if (typeof o.documentPath === "string" && o.documentPath.length > 0) {
		d.documentPath = o.documentPath;
	} else if (o.documentPath === null) {
		d.documentPath = null;
	}
	if (typeof o.activeChapterId === "string" && o.activeChapterId.length > 0) {
		d.activeChapterId = o.activeChapterId;
	} else if (o.activeChapterId === null) {
		d.activeChapterId = null;
	}
	if (typeof o.currentChunkIndex === "number" && o.currentChunkIndex >= 0) {
		d.currentChunkIndex = Math.floor(o.currentChunkIndex);
	}
	if (o.ttsTextRules !== undefined) {
		d.ttsTextRules = coerceTtsTextRulesState(o.ttsTextRules);
	}
	return d;
}

/** Session file stores paths and prefs only — never document body text. */
function webForDisk(web: WebPersistedSlice): WebPersistedSlice {
	return {
		voice: web.voice,
		volumePct: web.volumePct,
		speed: web.speed,
		documentPath:
			typeof web.documentPath === "string" && web.documentPath.length > 0
				? web.documentPath
				: null,
		activeChapterId:
			typeof web.activeChapterId === "string" && web.activeChapterId.length > 0
				? web.activeChapterId
				: null,
		currentChunkIndex: web.currentChunkIndex,
		ttsTextRules: web.ttsTextRules,
	};
}

export function loadAppSessionFile(): AppSessionFileV1 | null {
	const p = appSessionPath();
	if (!existsSync(p)) return null;
	try {
		const raw = readFileSync(p, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return null;
		const root = parsed as Record<string, unknown>;
		if (root.version !== APP_SESSION_VERSION) return null;
		let window: StoredWindowFrame | null = null;
		if (root.window && typeof root.window === "object") {
			const w = root.window as Record<string, unknown>;
			const cand: StoredWindowFrame = {
				x: Number(w.x),
				y: Number(w.y),
				width: Number(w.width),
				height: Number(w.height),
			};
			if (isSaneFrame(cand)) window = cand;
		}
		const web = coerceWeb(root.web);
		return { version: APP_SESSION_VERSION, window, web };
	} catch {
		return null;
	}
}

export function saveAppSessionFile(session: AppSessionFileV1): void {
	const p = appSessionPath();
	mkdirSync(dataDir(), { recursive: true });
	const safe: AppSessionFileV1 = {
		...session,
		web: webForDisk(session.web),
	};
	writeFileSync(p, JSON.stringify(safe, null, "\t"));
}

export function pickInitialWindowFrame(
	saved: AppSessionFileV1 | null,
	fallback: StoredWindowFrame,
): StoredWindowFrame {
	if (saved?.window && isSaneFrame(saved.window)) return saved.window;
	return fallback;
}
