import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { modelCacheDir } from "./appConfigStore";
import { downloadToFile } from "./modelCache";
import { hubFileSha256 } from "./securityGuards";
import {
	MODEL_FILES,
	MODEL_KINDS,
	type HubFile,
	type ModelKind,
	type ModelStatusMap,
} from "../shared/modelAssets";

const HF_ORIGIN = "https://huggingface.co";
/** Weights smaller than this are a stub/pointer, not the real model. */
const MIN_WEIGHTS_BYTES = 1_000_000;

const hfPath = (f: HubFile) => `/${f.repo}/resolve/${f.revision}/${f.path}`;

/** Mirrors the hub on-disk layout: <cache>/<repo>/resolve/<rev>/<file>. */
function filePath(f: HubFile): string {
	return join(modelCacheDir(), ...hfPath(f).slice(1).split("/"));
}

function fileBytes(p: string): number {
	try {
		return existsSync(p) ? statSync(p).size : 0;
	} catch {
		return 0;
	}
}

export function modelStatus(): ModelStatusMap {
	const out = {} as ModelStatusMap;
	for (const kind of MODEL_KINDS) {
		const bytes = fileBytes(filePath(MODEL_FILES[kind].weights));
		out[kind] = { present: bytes >= MIN_WEIGHTS_BYTES, bytes };
	}
	return out;
}

function fetchToDisk(
	f: HubFile,
	onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
	return downloadToFile(
		`${HF_ORIGIN}${hfPath(f)}`,
		filePath(f),
		hubFileSha256(hfPath(f)),
		onProgress,
	);
}

/** Download a model's weights (with progress) plus its sidecar files. */
export async function downloadModel(
	kind: ModelKind,
	onProgress: (loaded: number, total: number) => void,
): Promise<void> {
	const { weights, sidecars } = MODEL_FILES[kind];
	if (fileBytes(filePath(weights)) >= MIN_WEIGHTS_BYTES) {
		onProgress(1, 1);
		return;
	}
	await fetchToDisk(weights, onProgress);
	for (const f of sidecars) {
		if (fileBytes(filePath(f)) >= 1) continue;
		try {
			await fetchToDisk(f);
		} catch {
			// Optional file (404), or fetched again on demand by the hub.
		}
	}
}
