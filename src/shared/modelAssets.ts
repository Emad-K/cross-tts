/**
 * Kokoro ONNX model assets, split by dtype. Full-precision fp32 weights serve
 * both main paths — WebGPU *and* the native CPU engine (q8 is slower than fp32
 * on the native CPU EP). The quantized q8 weights are only loaded by the
 * last-resort in-app (wasm) fallback. transformers.js resolves these exact
 * file names from the dtype. Kind keys keep their historical names.
 */
import {
	PHONON_REPO,
	PHONON_REVISION,
	PHONON_SHA256,
	PHONON_VOICES,
	PHONON_VOICES_REPO,
	PHONON_VOICES_REVISION,
	PHONON_WEIGHTS,
	phononVoicePath,
} from "./phononAssets";

export type ModelKind = "cpu" | "gpu" | "phonon";

export const MODEL_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";

/**
 * Pinned commit of MODEL_REPO (its `main` as of 2025-02-08). Every download
 * goes through `/resolve/<MODEL_REVISION>/`, so an upstream push can't swap
 * the weights under us. Bump together with MODEL_SHA256.
 */
export const MODEL_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";

/** Repo-relative ONNX file per Kokoro model kind. */
export const MODEL_ONNX = {
	cpu: "onnx/model_quantized.onnx",
	gpu: "onnx/model.onnx",
} as const;

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

/**
 * A HuggingFace repo an engine may download from through the local hub. Only
 * files at `revision` with one of `extensions` are served. Every served file
 * must have a sha256 in `sha256` (keyed by repo-relative path) so its download
 * can be verified, unless its extension is in `unhashedExtensions` (small
 * config/metadata only; never weights such as onnx, gguf or safetensors).
 */
export type HubRepo = {
	repo: string;
	revision: string;
	extensions: readonly string[];
	unhashedExtensions: readonly string[];
	sha256: Readonly<Record<string, string>>;
};

/**
 * Hub allowlist per TTS engine id. Add a pinned entry for every new model repo,
 * with a sha256 for each weight file it serves.
 */
export const HUB_REPOS: Readonly<Record<string, readonly HubRepo[]>> = {
	kokoro: [
		{
			repo: MODEL_REPO,
			revision: MODEL_REVISION,
			extensions: ["json", "onnx", "bin"],
			// Configs, tokenizer and the per-voice style .bin files.
			unhashedExtensions: ["json", "bin"],
			sha256: MODEL_SHA256,
		},
	],
	phonon: [
		{
			repo: PHONON_REPO,
			revision: PHONON_REVISION,
			extensions: ["json", "gguf"],
			// config.json and tokenizer.json.
			unhashedExtensions: ["json"],
			sha256: PHONON_SHA256,
		},
		{
			repo: PHONON_VOICES_REPO,
			revision: PHONON_VOICES_REVISION,
			extensions: ["safetensors"],
			unhashedExtensions: [],
			sha256: Object.fromEntries(
				PHONON_VOICES.map(([id, , , sha]) => [phononVoicePath(id), sha]),
			),
		},
	],
};

/** One file of an allowlisted repo, at its pinned revision. */
export type HubFile = { repo: string; revision: string; path: string };

/**
 * What Settings → Storage downloads per model kind: the weights, the small
 * files loading needs (the model is present only when all are on disk), and
 * optional files that may 404.
 */
export const MODEL_FILES: Record<
	ModelKind,
	{ weights: HubFile; sidecars: readonly HubFile[]; optional: readonly HubFile[] }
> = (() => {
	const kokoro = (path: string): HubFile => ({
		repo: MODEL_REPO,
		revision: MODEL_REVISION,
		path,
	});
	const kokoroSidecars = ["config.json", "tokenizer.json"].map(kokoro);
	const kokoroOptional = ["tokenizer_config.json", "special_tokens_map.json"].map(kokoro);
	const phonon = (path: string): HubFile => ({
		repo: PHONON_REPO,
		revision: PHONON_REVISION,
		path,
	});
	return {
		cpu: {
			weights: kokoro(MODEL_ONNX.cpu),
			sidecars: kokoroSidecars,
			optional: kokoroOptional,
		},
		gpu: {
			weights: kokoro(MODEL_ONNX.gpu),
			sidecars: kokoroSidecars,
			optional: kokoroOptional,
		},
		phonon: {
			weights: phonon(PHONON_WEIGHTS),
			sidecars: [
				phonon("config.json"),
				phonon("tokenizer.json"),
				...PHONON_VOICES.map(([id]) => ({
					repo: PHONON_VOICES_REPO,
					revision: PHONON_VOICES_REVISION,
					path: phononVoicePath(id),
				})),
			],
			optional: [],
		},
	};
})();

export const MODEL_LABEL: Record<ModelKind, string> = {
	cpu: "Fallback model (compatibility)",
	gpu: "Voice model (GPU & CPU)",
	phonon: "Phonon 31M model and voices",
};

export const MODEL_KINDS: ModelKind[] = ["cpu", "gpu", "phonon"];

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
