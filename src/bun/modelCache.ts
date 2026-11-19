import { createHash, randomBytes } from "node:crypto";
import {
	closeSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	renameSync,
	rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MODEL_REPO, MODEL_REVISION, MODEL_SHA256 } from "../shared/modelAssets";

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
 * bytes after they were hashed. `opts.sha512` (base64, as NuGet publishes
 * it) is checked instead of `sha256`; `opts.signal` cancels the download.
 */
export async function downloadToFile(
	url: string,
	dest: string,
	sha256?: string,
	onProgress?: (loaded: number, total: number) => void,
	opts: { signal?: AbortSignal; sha512?: string } = {},
): Promise<void> {
	const res = await fetch(url, { redirect: "follow", signal: opts.signal });
	if (!res.ok || !res.body) {
		throw new Error(`Download failed ${res.status}: ${url}`);
	}
	const total = Number(res.headers.get("content-length") || 0);
	mkdirSync(dirname(dest), { recursive: true });
	const tmp = `${dest}.${randomBytes(6).toString("hex")}.download`;
	const hash = createHash(opts.sha512 ? "sha512" : "sha256");
	const expected = opts.sha512 ?? sha256;
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
			{ signal: opts.signal },
		);
		if (expected && hash.digest(opts.sha512 ? "base64" : "hex") !== expected) {
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
 * of re-downloading ~400 MB. They were downloaded unverified, so any ONNX
 * file whose sha256 doesn't match MODEL_SHA256 is deleted first (fetched
 * again on demand). No-op when there is nothing to move or the pinned folder
 * already exists.
 */
export function adoptLegacyModelCache(cacheDir: string): void {
	const base = join(cacheDir, ...MODEL_REPO.split("/"), "resolve");
	const legacy = join(base, "main");
	const pinned = join(base, MODEL_REVISION);
	if (!existsSync(legacy) || existsSync(pinned)) return;
	try {
		// ponytail: synchronous one-off hash (~1 s for ~400 MB at first launch).
		for (const [file, sha256] of Object.entries(MODEL_SHA256)) {
			const path = join(legacy, ...file.split("/"));
			if (existsSync(path) && sha256File(path) !== sha256) rmSync(path);
		}
		renameSync(legacy, pinned);
	} catch {
		// Leave it; files are fetched again at the pinned path.
	}
}

function sha256File(path: string): string {
	const hash = createHash("sha256");
	const buf = Buffer.allocUnsafe(1 << 20);
	const fd = openSync(path, "r");
	try {
		for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0; ) {
			hash.update(buf.subarray(0, n));
		}
	} finally {
		closeSync(fd);
	}
	return hash.digest("hex");
}
