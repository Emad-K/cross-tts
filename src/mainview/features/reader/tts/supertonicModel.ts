/**
 * Supertonic 3 inference, shared by the renderer worker (onnxruntime-web) and
 * the native utility process (onnxruntime-node). A port of the official
 * MIT-licensed JS helper (github.com/supertone-inc/supertonic, nodejs/ and
 * web/helper.js) onto flat typed arrays, with no runtime imports so either
 * ORT build can be passed in.
 *
 * Copyright (c) 2025 Supertone Inc. (MIT License; full notice in
 * third_party/supertonic-helper/LICENSE, shipped in resources/licenses).
 *
 * Pipeline: unicode text ids → duration predictor → text encoder → N
 * flow-matching denoising steps of the vector estimator on a noise latent →
 * vocoder → 44.1 kHz mono PCM.
 */

import { SUPERTONIC_REPO, SUPERTONIC_REVISION } from "@shared/modelAssets";
import { isPlausibleAudio } from "./audioPlausibility";
import { CANCELLED } from "./synthJobQueue";

export const SUPERTONIC_SAMPLE_RATE = 44_100;
/** Denoising steps the upstream examples default to (quality/speed knob). */
export const SUPERTONIC_DEFAULT_STEPS = 8;
export const SUPERTONIC_MIN_STEPS = 2;
export const SUPERTONIC_MAX_STEPS = 16;
/**
 * Upstream's default speed: our 1× maps to it so the default pace matches the
 * official examples.
 */
const BASE_SPEED = 1.05;
/** Silence between pieces of one chunk (upstream's `silenceDuration`). */
const PIECE_GAP_SEC = 0.3;

/** Languages Supertonic 3 reads (model card); "na" = language-agnostic. */
export const SUPERTONIC_LANGS = [
	"en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi",
	"fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro",
	"ru", "sk", "sl", "sv", "tr", "uk", "vi",
] as const;

/** ONNX graphs, repo-relative. */
export const SUPERTONIC_ONNX = {
	dp: "onnx/duration_predictor.onnx",
	textEnc: "onnx/text_encoder.onnx",
	vectorEst: "onnx/vector_estimator.onnx",
	vocoder: "onnx/vocoder.onnx",
} as const;
export const SUPERTONIC_CONFIG = "onnx/tts.json";
export const SUPERTONIC_INDEXER = "onnx/unicode_indexer.json";
export const SUPERTONIC_STYLES = [
	"F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5",
] as const;
export const supertonicStylePath = (style: string) =>
	`voice_styles/${style}.json`;
/** Combined size of the four ONNX graphs, for download progress. */
export const SUPERTONIC_ONNX_BYTES = 398_075_273;

/** Repo-relative path of a model file at the pinned revision. */
export const supertonicRepoPath = (file: string) =>
	`${SUPERTONIC_REPO}/resolve/${SUPERTONIC_REVISION}/${file}`;

/**
 * URL of a model file through the local hub. There is no remote fallback: only
 * the hub checks the files' sha256 pins and keeps them on disk.
 */
export function supertonicFileUrl(hubBaseUrl: string, file: string): string {
	const base = hubBaseUrl.endsWith("/") ? hubBaseUrl : `${hubBaseUrl}/`;
	return `${base}${supertonicRepoPath(file)}`;
}

/** Config, character table and every voice style; parsed once per load. */
export type SupertonicAssets = {
	cfg: SupertonicConfig;
	indexer: number[];
	styles: Map<string, SupertonicStyle>;
};

/**
 * Fetch the small files a load needs. The model's LICENSE is fetched too, so
 * the hub keeps a copy of it in the downloaded model directory.
 */
export async function loadSupertonicAssets(
	fetchText: (file: string) => Promise<string>,
): Promise<SupertonicAssets> {
	const [cfg, indexer, styles] = await Promise.all([
		fetchText(SUPERTONIC_CONFIG).then(JSON.parse),
		fetchText(SUPERTONIC_INDEXER).then(JSON.parse),
		Promise.all(
			SUPERTONIC_STYLES.map((s) =>
				fetchText(supertonicStylePath(s)).then((t) => parseVoiceStyle(JSON.parse(t))),
			),
		),
		fetchText("LICENSE"),
	]);
	return {
		cfg,
		indexer,
		styles: new Map(SUPERTONIC_STYLES.map((s, i) => [s, styles[i]])),
	};
}

// --- Minimal ORT surface (identical in onnxruntime-web and -node) ----------

export type OrtTensorLike = { data: unknown; dims: readonly number[] };
export type OrtSessionLike = {
	run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>;
};
export type OrtTensorCtor = new (
	type: "float32" | "int64",
	data: Float32Array | BigInt64Array,
	dims: number[],
) => OrtTensorLike;

export type SupertonicSessions = Record<keyof typeof SUPERTONIC_ONNX, OrtSessionLike>;

export type SupertonicConfig = {
	ae: { sample_rate: number; base_chunk_size: number };
	ttl: { chunk_compress_factor: number; latent_dim: number };
};

export type SupertonicStyle = {
	ttl: Float32Array;
	ttlDims: number[];
	dp: Float32Array;
	dpDims: number[];
};

type StyleJson = {
	style_ttl: { data: unknown; dims: number[] };
	style_dp: { data: unknown; dims: number[] };
};

/** A voice_styles/*.json file → flat style tensors. */
export function parseVoiceStyle(json: StyleJson): SupertonicStyle {
	const flat = (d: unknown) =>
		Float32Array.from((d as unknown[]).flat(Infinity) as number[]);
	return {
		ttl: flat(json.style_ttl.data),
		ttlDims: json.style_ttl.dims,
		dp: flat(json.style_dp.data),
		dpDims: json.style_dp.dims,
	};
}

// --- Text frontend ----------------------------------------------------------

const EMOJI_RE =
	/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

const SYMBOLS: readonly [string, string][] = [
	["–", "-"], ["‑", "-"], ["—", "-"], ["_", " "],
	["“", '"'], ["”", '"'], ["‘", "'"], ["’", "'"],
	["´", "'"], ["`", "'"], ["[", " "], ["]", " "], ["|", " "], ["/", " "],
	["#", " "], ["→", " "], ["←", " "],
];

/** Upstream's expression expansions — English words, so English text only. */
const ENGLISH_EXPRESSIONS: readonly [string, string][] = [
	["@", " at "],
	["e.g.,", "for example, "],
	["i.e.,", "that is, "],
];

/**
 * Upstream's text preprocessing, wrapped in the `<lang>` tags the model reads.
 * Only the "@", "e.g.", "i.e." expansions are language-specific; they apply
 * to English alone so no English words end up in other languages.
 */
export function preprocessSupertonicText(text: string, lang: string): string {
	let t = text.normalize("NFKD").replace(EMOJI_RE, "");
	for (const [k, v] of SYMBOLS) t = t.replaceAll(k, v);
	t = t.replace(/[♥☆♡©\\]/g, "");
	if (lang === "en") {
		for (const [k, v] of ENGLISH_EXPRESSIONS) t = t.replaceAll(k, v);
	}
	t = t.replace(/ ([,.!?;:'])/g, "$1");
	t = t.replace(/"{2,}/g, '"').replace(/'{2,}/g, "'");
	t = t.replace(/\s+/g, " ").trim();
	if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(t)) t += ".";
	return `<${lang}>${t}</${lang}>`;
}

/**
 * Character ids via the model's unicode indexer. Characters it has no id for
 * (-1, or outside the BMP table) are dropped rather than fed as -1.
 */
export function supertonicTextIds(
	text: string,
	indexer: ArrayLike<number>,
): number[] {
	const ids: number[] = [];
	for (const ch of text) {
		const id = indexer[ch.codePointAt(0)!];
		if (id !== undefined && id >= 0) ids.push(id);
	}
	return ids;
}

/** Longest text upstream feeds one inference (shorter for ko/ja). */
export function supertonicMaxChars(lang: string): number {
	return lang === "ko" || lang === "ja" ? 120 : 300;
}

/**
 * Split text into pieces of at most `maxLen` characters on sentence, then
 * word, boundaries (Intl.Segmenter, so languages without spaces work too);
 * a single overlong word is cut hard.
 */
export function splitForSupertonic(
	text: string,
	lang: string,
	maxLen: number,
): string[] {
	const segments = (s: string, granularity: "sentence" | "word") =>
		Array.from(new Intl.Segmenter(lang, { granularity }).segment(s), (x) => x.segment);
	const parts = segments(text, "sentence").flatMap((s) =>
		s.length > maxLen ? segments(s, "word") : [s],
	);
	const out: string[] = [];
	let cur = "";
	for (const p of parts) {
		if (cur && cur.length + p.length > maxLen) {
			out.push(cur);
			cur = "";
		}
		if (p.length > maxLen) {
			for (let i = 0; i < p.length; i += maxLen) out.push(p.slice(i, i + maxLen));
			continue;
		}
		cur += p;
	}
	if (cur) out.push(cur);
	return out.map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// --- Inference --------------------------------------------------------------

function gaussian(n: number): Float32Array {
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const u1 = Math.max(1e-10, Math.random());
		out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
	}
	return out;
}

/** One piece (≤ supertonicMaxChars) → PCM. */
export async function inferSupertonic(
	Tensor: OrtTensorCtor,
	s: SupertonicSessions,
	cfg: SupertonicConfig,
	indexer: ArrayLike<number>,
	text: string,
	lang: string,
	style: SupertonicStyle,
	steps: number,
	speed: number,
): Promise<Float32Array> {
	const ids = supertonicTextIds(preprocessSupertonicText(text, lang), indexer);
	const textIds = new Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]);
	const textMask = new Tensor("float32", new Float32Array(ids.length).fill(1), [1, 1, ids.length]);
	const styleTtl = new Tensor("float32", style.ttl, style.ttlDims);
	const styleDp = new Tensor("float32", style.dp, style.dpDims);

	const { duration } = await s.dp.run({ text_ids: textIds, style_dp: styleDp, text_mask: textMask });
	const seconds = (duration!.data as Float32Array)[0]! / (speed * BASE_SPEED);
	const { text_emb } = await s.textEnc.run({ text_ids: textIds, style_ttl: styleTtl, text_mask: textMask });

	const sr = cfg.ae.sample_rate;
	const wavLen = Math.floor(seconds * sr);
	const chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
	const latentLen = Math.max(1, Math.ceil(wavLen / chunk));
	const latentDim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
	const latentDims = [1, latentDim, latentLen];
	let latent = gaussian(latentDim * latentLen);
	const latentMask = new Tensor("float32", new Float32Array(latentLen).fill(1), [1, 1, latentLen]);
	const totalStep = new Tensor("float32", Float32Array.of(steps), [1]);

	for (let step = 0; step < steps; step++) {
		const out = await s.vectorEst.run({
			noisy_latent: new Tensor("float32", latent, latentDims),
			text_emb: text_emb!,
			style_ttl: styleTtl,
			text_mask: textMask,
			latent_mask: latentMask,
			total_step: totalStep,
			current_step: new Tensor("float32", Float32Array.of(step), [1]),
		});
		latent = out.denoised_latent!.data as Float32Array;
	}
	const { wav_tts } = await s.vocoder.run({
		latent: new Tensor("float32", latent, latentDims),
	});
	const wav = wav_tts!.data as Float32Array;
	return wav.slice(0, Math.min(wav.length, wavLen));
}

/**
 * A chunk of any length → PCM: split into model-sized pieces, synthesized in
 * order with a short gap between them. `beforePiece` runs before each piece
 * (yield + staleness check); returning true aborts with null.
 */
export async function synthesizeSupertonic(
	Tensor: OrtTensorCtor,
	sessions: SupertonicSessions,
	cfg: SupertonicConfig,
	indexer: ArrayLike<number>,
	text: string,
	lang: string,
	style: SupertonicStyle,
	steps: number,
	speed: number,
	beforePiece: () => Promise<boolean> = async () => false,
): Promise<Float32Array | null> {
	const pieces = splitForSupertonic(text, lang, supertonicMaxChars(lang));
	const gap = Math.floor(PIECE_GAP_SEC * cfg.ae.sample_rate);
	const audios: Float32Array[] = [];
	for (const piece of pieces) {
		if (await beforePiece()) return null;
		audios.push(
			await inferSupertonic(Tensor, sessions, cfg, indexer, piece, lang, style, steps, speed),
		);
	}
	if (audios.length === 0) return new Float32Array(0);
	const total = audios.reduce((n, a) => n + a.length, 0) + gap * (audios.length - 1);
	const joined = new Float32Array(total);
	let offset = 0;
	for (const a of audios) {
		joined.set(a, offset);
		offset += a.length + gap;
	}
	return joined;
}

// --- One request, as both workers run it ------------------------------------

/** `<lang>:<style>` voice id (see supertonicVoices.ts) → its parts, or null. */
export function parseSupertonicVoice(
	id: string,
): { lang: string; style: string } | null {
	const [lang, style, extra] = id.split(":");
	if (extra !== undefined || !lang || !style) return null;
	if (!(SUPERTONIC_LANGS as readonly string[]).includes(lang)) return null;
	if (!(SUPERTONIC_STYLES as readonly string[]).includes(style)) return null;
	return { lang, style };
}

export function clampSupertonicSteps(steps: number): number {
	if (!Number.isFinite(steps)) return SUPERTONIC_DEFAULT_STEPS;
	return Math.min(SUPERTONIC_MAX_STEPS, Math.max(SUPERTONIC_MIN_STEPS, Math.round(steps)));
}

export type SupertonicJob = { text: string; voice: string; speed: number; steps: number };

export type SupertonicRuntime = {
	Tensor: OrtTensorCtor;
	sessions: SupertonicSessions;
	assets: SupertonicAssets;
};

/**
 * Synthesize one request into the workers' reply shape. `isStale` runs before
 * every piece (it should yield so newer messages are read); a stale request
 * replies `CANCELLED`. Implausible audio (NaN, clipping, silence) is an error
 * so it is never played or cached.
 */
export async function runSupertonicJob(
	rt: SupertonicRuntime,
	job: SupertonicJob,
	isStale: () => Promise<boolean>,
): Promise<{ audio?: Float32Array; empty?: true; error?: string }> {
	const v = parseSupertonicVoice(job.voice);
	const style = v && rt.assets.styles.get(v.style);
	if (!v || !style) return { error: `Unknown Supertonic voice: ${job.voice}` };
	const pcm = await synthesizeSupertonic(
		rt.Tensor,
		rt.sessions,
		rt.assets.cfg,
		rt.assets.indexer,
		job.text,
		v.lang,
		style,
		clampSupertonicSteps(job.steps),
		job.speed,
		isStale,
	);
	if (pcm === null) return { error: CANCELLED };
	if (pcm.length === 0) return { empty: true };
	if (!isPlausibleAudio(pcm)) return { error: "bad-output" };
	return { audio: pcm };
}
