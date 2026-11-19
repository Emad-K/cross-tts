import type { TtsBackend } from "@shared/appConfig";
import type { ModelKind, ModelStatusMap } from "@shared/modelAssets";

/** A model download: a Kokoro/Phonon model kind, or Supertonic's own files. */
export type EngineModel = ModelKind | "supertonic";

/** Which model files are on disk, as the main process reports them. */
export type ModelsOnDisk = { status: ModelStatusMap; supertonic: boolean };

/**
 * The downloads loading `engineId` may need with this backend choice; the
 * first is the one it normally loads. Kokoro runs its fp32 weights everywhere
 * but on the in-app WASM fallback, which loads q8: that is the only step left
 * after WebGPU where there is no native engine (`native` false).
 */
export function engineModels(
	engineId: string,
	backend: TtsBackend,
	native: boolean,
): EngineModel[] {
	if (engineId === "supertonic" || engineId === "phonon") return [engineId];
	if (backend === "wasm") return ["cpu"];
	return native ? ["gpu"] : ["gpu", "cpu"];
}

export function modelOnDisk(model: EngineModel, disk: ModelsOnDisk | null): boolean {
	if (!disk) return false;
	return model === "supertonic" ? disk.supertonic : disk.status[model].present;
}

/**
 * True when loading the engine can't start a model download: everything it
 * may load is already on disk. Opening a document warms the model only then.
 */
export function canLoadWithoutDownload(
	engineId: string,
	backend: TtsBackend,
	native: boolean,
	disk: ModelsOnDisk | null,
): boolean {
	return engineModels(engineId, backend, native).every((m) => modelOnDisk(m, disk));
}
