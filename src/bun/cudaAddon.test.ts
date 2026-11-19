import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import {
	CUDA_ADDON,
	type CudaAddonPackage,
	cudaAddonDir,
	cudaAddonInstalled,
	installCudaAddon,
	pruneCudaAddons,
	removeCudaAddon,
	cudaAddonErrorText,
} from "./cudaAddon";

const NATIVE = "runtimes/linux-x64/native/";
const cudaLib = "cuda provider ".repeat(5000);
const sharedLib = "shared";

// A small stand-in for the NuGet package, served from localhost.
const zip = new JSZip();
zip.file(`${NATIVE}libonnxruntime_providers_cuda.so`, cudaLib);
zip.file(`${NATIVE}libonnxruntime_providers_shared.so`, sharedLib, { compression: "STORE" });
zip.file(`${NATIVE}libonnxruntime_providers_tensorrt.so`, "not wanted");
zip.file("LICENSE", "x");
const nupkg = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
let slow = false;
const server = Bun.serve({
	port: 0,
	fetch: () =>
		slow
			? new Response(
					new ReadableStream({
						async pull(c) {
							await new Promise((r) => setTimeout(r, 20));
							c.enqueue(nupkg.subarray(0, 64));
						},
					}),
				)
			: new Response(nupkg),
});
afterAll(() => server.stop(true));

const pkg: CudaAddonPackage = {
	ortVersion: "9.9.9",
	url: `http://127.0.0.1:${server.port}/addon.nupkg`,
	bytes: nupkg.length,
	sha512: createHash("sha512").update(nupkg).digest("base64"),
	files: {
		[`${NATIVE}libonnxruntime_providers_cuda.so`]: cudaLib.length,
		[`${NATIVE}libonnxruntime_providers_shared.so`]: sharedLib.length,
	},
};

function dirs() {
	const root = mkdtempSync(join(tmpdir(), "cuda-addon-"));
	const bindingDir = join(root, "binding");
	mkdirSync(bindingDir);
	writeFileSync(join(bindingDir, "libonnxruntime.so.1"), "ort");
	return { userData: join(root, "userData"), bindingDir };
}

describe("installCudaAddon", () => {
	test("downloads, verifies and unpacks only the wanted libraries", async () => {
		const d = dirs();
		const seen: number[] = [];
		await installCudaAddon({ ...d, pkg, onProgress: (loaded) => seen.push(loaded) });
		const dir = cudaAddonDir(d.userData, pkg);
		expect(readdirSync(dir).sort()).toEqual([
			".complete",
			"libonnxruntime.so.1",
			"libonnxruntime_providers_cuda.so",
			"libonnxruntime_providers_shared.so",
		]);
		expect(readFileSync(join(dir, "libonnxruntime_providers_cuda.so"), "utf8")).toBe(cudaLib);
		expect(readFileSync(join(dir, "libonnxruntime_providers_shared.so"), "utf8")).toBe(sharedLib);
		expect(readFileSync(join(dir, "libonnxruntime.so.1"), "utf8")).toBe("ort");
		expect(seen.at(-1)).toBe(nupkg.length);
		expect(cudaAddonInstalled(d.userData, pkg)).toBe(true);

		removeCudaAddon(d.userData);
		expect(cudaAddonInstalled(d.userData, pkg)).toBe(false);
	});

	test("a hash mismatch installs nothing", async () => {
		const d = dirs();
		await expect(
			installCudaAddon({ ...d, pkg: { ...pkg, sha512: "AAAA" } }),
		).rejects.toThrow(/Checksum mismatch/);
		expect(cudaAddonInstalled(d.userData, pkg)).toBe(false);
		expect(existsSync(cudaAddonDir(d.userData, pkg))).toBe(false);
	});

	test("a library of the wrong size installs nothing", async () => {
		const d = dirs();
		const files = { ...pkg.files, [`${NATIVE}libonnxruntime_providers_shared.so`]: 7 };
		await expect(installCudaAddon({ ...d, pkg: { ...pkg, files } })).rejects.toThrow(
			/Unexpected size/,
		);
		expect(existsSync(cudaAddonDir(d.userData, pkg))).toBe(false);
	});

	test("cancelling stops the download and installs nothing", async () => {
		const d = dirs();
		slow = true;
		const abort = new AbortController();
		const run = installCudaAddon({ ...d, pkg, signal: abort.signal });
		setTimeout(() => abort.abort(), 60);
		await expect(run).rejects.toThrow();
		slow = false;
		expect(existsSync(cudaAddonDir(d.userData, pkg))).toBe(false);
	});
});

describe("pruneCudaAddons", () => {
	test("keeps only a finished install for the current ONNX Runtime", async () => {
		const d = dirs();
		await installCudaAddon({ ...d, pkg });
		mkdirSync(join(d.userData, "ort-cuda", "1.0.0"));
		pruneCudaAddons(d.userData, pkg);
		expect(readdirSync(join(d.userData, "ort-cuda"))).toEqual(["9.9.9"]);
		// After an ONNX Runtime bump the old add-on can't be loaded: drop it.
		pruneCudaAddons(d.userData, { ...pkg, ortVersion: "10.0.0" });
		expect(readdirSync(join(d.userData, "ort-cuda"))).toEqual([]);
	});
});

test("the pinned add-on matches the installed onnxruntime-node", () => {
	// Bumping ONNX Runtime without updating CUDA_ADDON (url, bytes, sha512,
	// file sizes) would pair new binaries with an old provider.
	const fromTransformers = createRequire(require.resolve("@huggingface/transformers"));
	const { version } = fromTransformers("onnxruntime-node/package.json") as { version: string };
	expect(CUDA_ADDON.ortVersion).toBe(version);
	expect(CUDA_ADDON.url).toContain(`/${version}/`);
});

test("install errors: network failures get advice, the rest keep their text", async () => {
	const offline = await fetch("http://127.0.0.1:1/x").catch((e: unknown) => e);
	expect(cudaAddonErrorText(offline)).toMatch(/^Couldn't reach nuget\.org/);
	expect(cudaAddonErrorText(new Error("Download failed 503: https://x"))).toMatch(
		/^Couldn't reach nuget\.org/,
	);
	expect(cudaAddonErrorText(new Error("Not enough free disk space"))).toBe(
		"Not enough free disk space",
	);
});
