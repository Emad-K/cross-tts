import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MODEL_REPO, MODEL_REVISION } from "../shared/modelAssets";

/**
 * Model cache helpers shared by the hub server and the Settings downloader.
 * Electron-free so they can be unit tested with bun.
 */

/**
 * Stream `url` to a temp file next to `dest`, then rename it to `dest`. With
 * `sha256` the bytes are hashed on the way and a mismatch deletes the temp
 * file and throws, so a corrupt or swapped file never lands at `dest`. The
 * temp name is unique per call: the hub and the Settings downloader can fetch
 * the same file at once, and a shared temp would let one truncate the other's
 * bytes after they were hashed.
 */
export async function downloadToFile(
	url: string,
	dest: string,
	sha256?: string,
	onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
	const res = await fetch(url, { redirect: "follow" });
	if (!res.ok || !res.body) {
		throw new Error(`Download failed ${res.status}: ${url}`);
	}
	const total = Number(res.headers.get("content-length") || 0);
	mkdirSync(dirname(dest), { recursive: true });
	const tmp = `${dest}.${randomBytes(6).toString("hex")}.download`;
	const hash = createHash("sha256");
	let loaded = 0;
	try {
		await pipeline(
			Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
			async function* (src: AsyncIterable<Buffer>) {
				for await (const chunk of src) {
					hash.update(chunk);
					loaded += chunk.length;
					onProgress?.(loaded, total);
					yield chunk;
				}
			},
			createWriteStream(tmp),
		);
		if (sha256 && hash.digest("hex") !== sha256) {
			throw new Error(`Checksum mismatch, download discarded: ${url}`);
		}
		renameSync(tmp, dest);
	} catch (e) {
		rmSync(tmp, { force: true });
		throw e;
	}
}

/**
 * Builds before the revision pin cached files under `<repo>/resolve/main/`.
 * The model files there are byte-identical to MODEL_REVISION (upstream hasn't
 * touched them since), so move that folder to the pinned path once instead
 * of re-downloading ~400 MB. No-op when there is nothing to move or the
 * pinned folder already exists.
 */
export function adoptLegacyModelCache(cacheDir: string): void {
	const base = join(cacheDir, ...MODEL_REPO.split("/"), "resolve");
	const legacy = join(base, "main");
	const pinned = join(base, MODEL_REVISION);
	if (!existsSync(legacy) || existsSync(pinned)) return;
	try {
		renameSync(legacy, pinned);
	} catch {
		// Leave it; files are fetched again at the pinned path.
	}
}
