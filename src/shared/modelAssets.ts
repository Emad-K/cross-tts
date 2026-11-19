/**
 * Kokoro ONNX model assets, split by dtype. Full-precision fp32 weights serve
 * both main paths — WebGPU *and* the native CPU engine (q8 is slower than fp32
 * on the native CPU EP). The quantized q8 weights are only loaded by the
 * last-resort in-app (wasm) fallback. transformers.js resolves these exact
 * file names from the dtype. Kind keys keep their historical names.
 */
export type ModelKind = "cpu" | "gpu";

export const MODEL_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";

/**
 * Pinned commit of MODEL_REPO (its `main` as of 2025-02-08). Every download
 * goes through `/resolve/<MODEL_REVISION>/`, so an upstream push can't swap
 * the weights under us. Bump together with MODEL_SHA256.
 */
export const MODEL_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";

/** Repo-relative ONNX file per model kind. */
export const MODEL_ONNX: Record<ModelKind, string> = {
	cpu: "onnx/model_quantized.onnx",
	gpu: "onnx/model.onnx",
};

/**
 * sha256 (HF LFS oid at MODEL_REVISION) of every ONNX file the app loads.
 * Downloads are verified against it; ONNX files not listed aren't served.
 */
export const MODEL_SHA256: Readonly<Record<string, string>> = {
	"onnx/model_quantized.onnx":
		"fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478",
	"onnx/model.onnx":
		"8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb",
};

export const MODEL_LABEL: Record<ModelKind, string> = {
	cpu: "Fallback model (compatibility)",
	gpu: "Voice model (GPU & CPU)",
};

export const MODEL_KINDS: ModelKind[] = ["cpu", "gpu"];

export type ModelStatus = { present: boolean; bytes: number };
export type ModelStatusMap = Record<ModelKind, ModelStatus>;

/** Progress update forwarded main→renderer during a model download. */
export type ModelProgress = {
	kind: ModelKind;
	loaded: number;
	total: number;
	done: boolean;
	error?: string;
};
