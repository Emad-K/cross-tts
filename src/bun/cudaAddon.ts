import { createReadStream, createWriteStream, existsSync, readdirSync, rmSync } from "node:fs";
import { copyFile, mkdir, open, stat, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import { downloadToFile } from "./modelCache";

/**
 * The CUDA add-on: ONNX Runtime's CUDA provider libraries, which are too big
 * to ship (234 MB download). They are fetched from NuGet only after the user
 * asks, checked against a pinned SHA-512, and kept in the user's app-data
 * folder because the installed app is read-only. ORT looks for providers
 * next to libonnxruntime, so a copy of that sits in the same folder and the
 * native engine is started with LD_LIBRARY_PATH pointing there (ttsNode.ts).
 * Electron-free so it can be unit tested with bun.
 */

export type CudaAddonPackage = {
	/** Must equal the installed onnxruntime-node version (see the test). */
	ortVersion: string;
	url: string;
	bytes: number;
	/** Base64 SHA-512 of the package, from the NuGet catalog. */
	sha512: string;
	/** Zip entry → uncompressed size of each library to extract. */
	files: Readonly<Record<string, number>>;
};

export const CUDA_ADDON: CudaAddonPackage = {
	ortVersion: "1.31.1",
	url: "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.linux/1.31.1/microsoft.ml.onnxruntime.gpu.linux.1.31.1.nupkg",
	bytes: 244_926_281,
	sha512:
		"iB4gKnPUwfeJN01l5Yeuz40Uy1IM/8v1pj/DTrvslbqYNsMEBhw4Mp8LcJgDAGo7zkLlkSFqgJCV9zWXkMgdjQ==",
	files: {
		"runtimes/linux-x64/native/libonnxruntime_providers_cuda.so": 284_011_000,
		"runtimes/linux-x64/native/libonnxruntime_providers_shared.so": 14_632,
	},
};

/** The library ORT's own loader must find first; copied from the app. */
const ORT_LIB = "libonnxruntime.so.1";
const MARKER = ".complete";
const ROOT = "ort-cuda";

export function cudaAddonDir(userData: string, pkg = CUDA_ADDON): string {
	return join(userData, ROOT, pkg.ortVersion);
}

/** The marker is written last, so a half-finished install never counts. */
export function cudaAddonInstalled(userData: string, pkg = CUDA_ADDON): boolean {
	return existsSync(join(cudaAddonDir(userData, pkg), MARKER));
}

export function removeCudaAddon(userData: string): void {
	rmSync(join(userData, ROOT), { recursive: true, force: true });
}

/**
 * At startup: delete add-ons for other ONNX Runtime versions (an app update
 * changed it; they can't be loaded) and installs that never finished.
 */
export function pruneCudaAddons(userData: string, pkg = CUDA_ADDON): void {
	let names: string[] = [];
	try {
		names = readdirSync(join(userData, ROOT));
	} catch {
		return;
	}
	for (const name of names) {
		if (name === pkg.ortVersion && cudaAddonInstalled(userData, pkg)) continue;
		rmSync(join(userData, ROOT, name), { recursive: true, force: true });
	}
}

/**
 * Extract `files` (entry name → expected size) from a zip into `destDir`
 * under their base names. Reads only the central directory and those
 * entries. No zip64 or encryption: the NuGet package uses neither.
 */
export async function extractZipEntries(
	zipPath: string,
	files: Readonly<Record<string, number>>,
	destDir: string,
	signal?: AbortSignal,
): Promise<void> {
	const fd = await open(zipPath, "r");
	try {
		const read = async (pos: number, len: number) =>
			(await fd.read(Buffer.alloc(len), 0, len, pos)).buffer;
		const { size } = await fd.stat();
		// End-of-central-directory record: within the last 64 KiB + 22 bytes.
		const tail = await read(Math.max(0, size - 65_557), Math.min(size, 65_557));
		const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
		if (eocd < 0) throw new Error("Not a zip file");
		const dir = await read(tail.readUInt32LE(eocd + 16), tail.readUInt32LE(eocd + 12));
		const left = new Set(Object.keys(files));
		for (let p = 0; p + 46 <= dir.length && dir.readUInt32LE(p) === 0x02014b50; ) {
			const nameLen = dir.readUInt16LE(p + 28);
			const name = dir.toString("utf8", p + 46, p + 46 + nameLen);
			if (left.has(name)) {
				const method = dir.readUInt16LE(p + 10);
				const packed = dir.readUInt32LE(p + 20);
				const offset = dir.readUInt32LE(p + 42);
				if (dir.readUInt32LE(p + 24) !== files[name] || (method !== 0 && method !== 8)) {
					throw new Error(`Unexpected size or compression for ${name}`);
				}
				// The data follows the local header, whose name/extra lengths can
				// differ from the central directory's.
				const local = await read(offset, 30);
				const start = offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
				const out = join(destDir, name.slice(name.lastIndexOf("/") + 1));
				await pipeline(
					[
						createReadStream(zipPath, { start, end: start + packed - 1 }),
						...(method === 8 ? [createInflateRaw()] : []),
						createWriteStream(out),
					],
					{ signal },
				);
				if ((await stat(out)).size !== files[name]) {
					throw new Error(`Extracted size mismatch for ${name}`);
				}
				left.delete(name);
			}
			p += 46 + nameLen + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
		}
		if (left.size > 0) throw new Error(`Missing from the package: ${[...left].join(", ")}`);
	} finally {
		await fd.close();
	}
}

/**
 * Download, verify and unpack the add-on. Throws on cancel (signal), a hash
 * mismatch, or too little disk space; nothing usable is left behind then.
 * `bindingDir` is where the app's own libonnxruntime lives.
 */
export async function installCudaAddon(opts: {
	userData: string;
	bindingDir: string;
	signal?: AbortSignal;
	onProgress?: (loaded: number, total: number) => void;
	pkg?: CudaAddonPackage;
}): Promise<void> {
	const pkg = opts.pkg ?? CUDA_ADDON;
	const dir = cudaAddonDir(opts.userData, pkg);
	rmSync(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	try {
		// The package and the unpacked libraries are both on disk for a moment.
		const ortLibBytes = (await stat(join(opts.bindingDir, ORT_LIB))).size;
		const needed =
			pkg.bytes + ortLibBytes + Object.values(pkg.files).reduce((a, b) => a + b, 0);
		const fs = await statfs(dir);
		if (fs.bavail * fs.bsize < needed) {
			throw new Error(
				`Not enough free disk space: the CUDA add-on needs about ${Math.ceil(needed / 1e6)} MB while installing.`,
			);
		}
		const nupkg = join(dir, "addon.nupkg");
		await downloadToFile(
			pkg.url,
			nupkg,
			undefined,
			(loaded) => opts.onProgress?.(loaded, pkg.bytes),
			{ signal: opts.signal, sha512: pkg.sha512, maxBytes: pkg.bytes },
		);
		await extractZipEntries(nupkg, pkg.files, dir, opts.signal);
		await copyFile(join(opts.bindingDir, ORT_LIB), join(dir, ORT_LIB));
		rmSync(nupkg);
		await writeFile(join(dir, MARKER), "");
	} catch (e) {
		rmSync(dir, { recursive: true, force: true });
		throw e;
	}
}
