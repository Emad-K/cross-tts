import {
	createWriteStream,
	existsSync,
	mkdirSync,
	renameSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { modelCacheDir } from "./appConfigStore";
import {
	MODEL_KINDS,
	MODEL_ONNX,
	MODEL_REPO,
	type ModelKind,
	type ModelStatusMap,
} from "../shared/modelAssets";

const HF_ORIGIN = "https://huggingface.co";
/** An ONNX smaller than this is a stub/pointer, not the real model. */
const MIN_ONNX_BYTES = 1_000_000;
/** Tiny shared files a model needs to load (best-effort; some may not exist). */
const SIDECARS = [
	"config.json",
	"tokenizer.json",
	"tokenizer_config.json",
	"special_tokens_map.json",
];

/** Mirrors the hub on-disk layout: <cache>/<repo>/resolve/main/<file>. */
function repoFilePath(repoRelative: string): string {
	return join(
		modelCacheDir(),
		...`${MODEL_REPO}/resolve/main/${repoRelative}`.split("/"),
	);
}

function fileBytes(p: string): number {
	try {
		return existsSync(p) ? statSync(p).size : 0;
	} catch {
		return 0;
	}
}

function onnxPath(kind: ModelKind): string {
	return repoFilePath(MODEL_ONNX[kind]);
}

export function modelStatus(): ModelStatusMap {
	const out = {} as ModelStatusMap;
	for (const kind of MODEL_KINDS) {
		const bytes = fileBytes(onnxPath(kind));
		out[kind] = { present: bytes >= MIN_ONNX_BYTES, bytes };
	}
	return out;
}

async function fetchToDisk(
	repoRelative: string,
	onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
	const dest = repoFilePath(repoRelative);
	const url = `${HF_ORIGIN}/${MODEL_REPO}/resolve/main/${repoRelative}`;
	const res = await fetch(url, { redirect: "follow" });
	if (!res.ok || !res.body) {
		throw new Error(`Download failed ${res.status}: ${repoRelative}`);
	}
	const total = Number(res.headers.get("content-length") || 0);
	mkdirSync(join(dest, ".."), { recursive: true });
	const tmp = `${dest}.download`;
	let loaded = 0;
	const reader = Readable.fromWeb(
		res.body as Parameters<typeof Readable.fromWeb>[0],
	);
	if (onProgress) {
		reader.on("data", (chunk: Buffer) => {
			loaded += chunk.length;
			onProgress(loaded, total);
		});
	}
	await pipeline(reader, createWriteStream(tmp));
	renameSync(tmp, dest);
}

/** Download a model's ONNX (with progress) plus its shared sidecar files. */
export async function downloadModel(
	kind: ModelKind,
	onProgress: (loaded: number, total: number) => void,
): Promise<void> {
	if (fileBytes(onnxPath(kind)) >= MIN_ONNX_BYTES) {
		onProgress(1, 1);
		return;
	}
	await fetchToDisk(MODEL_ONNX[kind], onProgress);
	for (const f of SIDECARS) {
		if (fileBytes(repoFilePath(f)) >= 1) continue;
		try {
			await fetchToDisk(f);
		} catch {
			// Optional file (404) — ignore.
		}
	}
}
