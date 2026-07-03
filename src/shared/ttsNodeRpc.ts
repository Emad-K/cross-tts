import type { PronunciationRule } from "./ttsTextRules";

/**
 * Renderer ↔ main ↔ utility-process RPC for the native CPU TTS backend.
 *
 * When no GPU is available, synthesis runs in an Electron utility process on
 * onnxruntime-node (native CPU EP) instead of the renderer's WASM backend —
 * measured ~2.5× faster on the same machine (fp32 native ≈ 3.5–4× realtime vs
 * WASM ≈ 1×), which is the difference between smooth playback and starvation.
 */

export type TtsNodeVoiceOption = { id: string; label: string };

export type TtsNodeInitResult =
	| { ok: true; voices: TtsNodeVoiceOption[]; loadMs: number }
	| { ok: false; error: string };

export type TtsNodeGenerateParams = {
	text: string;
	voice: string;
	speed: number;
	pronunciationRules: PronunciationRule[];
};

export type TtsNodeGenerateResult =
	| { kind: "audio"; audio: Float32Array; samplingRate: number; synthMs: number }
	| { kind: "empty" }
	| { kind: "error"; message: string };
