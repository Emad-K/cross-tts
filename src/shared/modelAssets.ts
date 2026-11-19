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
 * Supertonic 3 (OpenRAIL-M weights). Supertone archived the project and now
 * publishes the weights from this namespace; the ONNX files are byte-identical
 * to the original Supertone/supertonic-3 release.
 */
export const SUPERTONIC_REPO = "supertone-oss-archive/supertonic-3";
/** The archive snapshot upstream's README pins. Bump with SUPERTONIC_SHA256. */
export const SUPERTONIC_REVISION = "aafc6e32416a594460b32413efc49d7fe4ce6d46";

/** sha256 of every Supertonic file the app fetches (all of them are pinned). */
export const SUPERTONIC_SHA256: Readonly<Record<string, string>> = {
	LICENSE: "0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f",
	"onnx/duration_predictor.onnx":
		"c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db",
	"onnx/text_encoder.onnx":
		"c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff",
	"onnx/vector_estimator.onnx":
		"883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c",
	"onnx/vocoder.onnx":
		"085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba",
	"onnx/tts.json":
		"42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09",
	"onnx/unicode_indexer.json":
		"9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f",
	"voice_styles/F1.json":
		"bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2",
	"voice_styles/F2.json":
		"7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6",
	"voice_styles/F3.json":
		"12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab",
	"voice_styles/F4.json":
		"c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b",
	"voice_styles/F5.json":
		"45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d",
	"voice_styles/M1.json":
		"e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b",
	"voice_styles/M2.json":
		"b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50",
	"voice_styles/M3.json":
		"ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b",
	"voice_styles/M4.json":
		"ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303",
	"voice_styles/M5.json":
		"dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2",
};

/**
 * Hub allowlist per TTS engine id. Add a pinned entry for every new model repo,
 * with a sha256 for each weight file it serves. A file listed in `sha256` is
 * served even without an allowed extension (e.g. a LICENSE).
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
	supertonic: [
		{
			repo: SUPERTONIC_REPO,
			revision: SUPERTONIC_REVISION,
			extensions: ["json", "onnx"],
			unhashedExtensions: [],
			sha256: SUPERTONIC_SHA256,
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
