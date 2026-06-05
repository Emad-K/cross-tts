/**
 * Kokoro ONNX model assets, split by the device that uses them. The CPU (wasm)
 * path loads the quantized q8 weights; the GPU (WebGPU) path loads full-precision
 * fp32 weights. transformers.js resolves these exact file names from the dtype.
 */
export type ModelKind = "cpu" | "gpu";

export const MODEL_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** Repo-relative ONNX file per model kind. */
export const MODEL_ONNX: Record<ModelKind, string> = {
	cpu: "onnx/model_quantized.onnx",
	gpu: "onnx/model.onnx",
};

export const MODEL_LABEL: Record<ModelKind, string> = {
	cpu: "CPU model",
	gpu: "GPU model",
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
