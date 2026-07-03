/**
 * Kokoro ONNX model assets, split by dtype. Full-precision fp32 weights serve
 * both main paths — WebGPU *and* the native CPU engine (q8 is slower than fp32
 * on the native CPU EP). The quantized q8 weights are only loaded by the
 * last-resort in-app (wasm) fallback. transformers.js resolves these exact
 * file names from the dtype. Kind keys keep their historical names.
 */
export type ModelKind = "cpu" | "gpu";

export const MODEL_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** Repo-relative ONNX file per model kind. */
export const MODEL_ONNX: Record<ModelKind, string> = {
	cpu: "onnx/model_quantized.onnx",
	gpu: "onnx/model.onnx",
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
