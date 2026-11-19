import type { PronunciationRule } from "./ttsTextRules";

/**
 * Renderer ↔ main ↔ utility-process RPC for the native CPU TTS backend.
 *
 * When no GPU is available, synthesis runs in an Electron utility process on
 * onnxruntime-node (native CPU EP) instead of the renderer's WASM backend —
 * measured ~2.5× faster on the same machine (fp32 native ≈ 3.5–4× realtime vs
 * WASM ≈ 1×), which is the difference between smooth playback and starvation.
 */

/** Engines with a native backend (one utility process entry each). */
export type TtsNodeEngine = "kokoro" | "supertonic";

/**
 * ONNX Runtime execution provider for the native engine: the CPU, NVIDIA
 * CUDA (Linux, needs the add-on) or DirectML (Windows). Kokoro only;
 * Supertonic always runs on the CPU.
 */
export type TtsNodeEp = "cpu" | "cuda" | "dml";

export type TtsNodeVoiceOption = { id: string; label: string };

export type TtsNodeInitResult =
	| {
			ok: true;
			voices: TtsNodeVoiceOption[];
			loadMs: number;
			/** Provider the model actually loaded on (CPU after a fallback). */
			device: TtsNodeEp;
	  }
	| { ok: false; error: string };

export type TtsNodeGenerateParams = {
	text: string;
	voice: string;
	speed: number;
	pronunciationRules: PronunciationRule[];
	/** Supertonic denoising steps (quality/speed); ignored by Kokoro. */
	steps?: number;
	/**
	 * Playback epoch. Once a newer epoch arrives, queued older-epoch jobs reply
	 * with error "cancelled". Omitted for export, which is never cancelled.
	 */
	epoch?: number;
};

export type TtsNodeGenerateResult =
	| {
			kind: "audio";
			audio: Float32Array;
			samplingRate: number;
			synthMs: number;
			/** Provider that made this audio; CPU once a GPU run has failed. */
			device: TtsNodeEp;
	  }
	| { kind: "empty" }
	| { kind: "error"; message: string };
