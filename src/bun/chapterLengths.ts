import { statSync } from "node:fs";
import { ipcMain } from "electron";
import { readEpubChapterContent, readEpubManifest } from "./epub/parseEpub";

/** Books whose chapter lengths stay cached (keyed by path + mtime + size). */
const CACHE_MAX = 4;
const cache = new Map<string, Promise<Record<string, number> | null>>();

async function epubChapterLengths(
	filePath: string,
): Promise<Record<string, number> | null> {
	const manifest = await readEpubManifest(filePath);
	if (!manifest) return null;
	const lengths: Record<string, number> = {};
	for (const { id } of manifest.chapters) {
		if (id in lengths) continue;
		lengths[id] = (await readEpubChapterContent(filePath, id))?.text.length ?? 0;
		// Converting a chapter is synchronous work: let other IPC run in between.
		await new Promise((resolve) => setImmediate(resolve));
	}
	return lengths;
}

/**
 * Plain-text length (characters) of every chapter, keyed by chapter id, for
 * the "time left in book" estimate. EPUB only: other formats return null and
 * the player simply shows the chapter estimate.
 */
export function getChapterTextLengths(
	filePath: string,
): Promise<Record<string, number> | null> {
	if (typeof filePath !== "string" || !filePath.toLowerCase().endsWith(".epub")) {
		return Promise.resolve(null);
	}
	let key: string;
	try {
		const st = statSync(filePath);
		key = `${filePath}:${st.mtimeMs}:${st.size}`;
	} catch {
		return Promise.resolve(null);
	}
	let hit = cache.get(key);
	if (!hit) {
		hit = epubChapterLengths(filePath).catch(() => null);
		cache.set(key, hit);
		if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
	}
	return hit;
}

export function registerChapterLengthHandlers(): void {
	ipcMain.handle(
		"getChapterTextLengths",
		(_event, { filePath }: { filePath: string }) =>
			getChapterTextLengths(filePath),
	);
}
