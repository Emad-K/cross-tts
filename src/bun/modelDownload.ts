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
		const { weights, sidecars } = MODEL_FILES[kind];
		const bytes = fileBytes(filePath(weights));
		out[kind] = {
			present:
				bytes >= MIN_WEIGHTS_BYTES && sidecars.every((f) => fileBytes(filePath(f)) >= 1),
			bytes,
		};
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

/**
 * Download whatever of a model's files is missing: the weights (with
 * progress), then its sidecars. A sidecar that fails fails the download.
 */
export async function downloadModel(
	kind: ModelKind,
	onProgress: (loaded: number, total: number) => void,
): Promise<void> {
	const { weights, sidecars, optional } = MODEL_FILES[kind];
	if (fileBytes(filePath(weights)) >= MIN_WEIGHTS_BYTES) onProgress(1, 1);
	else await fetchToDisk(weights, onProgress);
	for (const f of sidecars) {
		if (fileBytes(filePath(f)) < 1) await fetchToDisk(f);
	}
	for (const f of optional) {
		if (fileBytes(filePath(f)) >= 1) continue;
		try {
			await fetchToDisk(f);
		} catch {
			// May not exist upstream (404).
		}
	}
}
