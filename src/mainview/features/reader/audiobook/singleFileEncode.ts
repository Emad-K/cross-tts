/**
 * Single-file audiobook encoders (chapter markers + embedded cover).
 *
 * Preferred path: WebCodecs `AudioEncoder` with AAC-LC ('mp4a.40.2') muxed
 * into MP4 by mp4-muxer, then post-processed with Nero `chpl` chapters and
 * iTunes `ilst` metadata (title + cover) → an .m4b file.
 *
 * AAC encoding in Chromium relies on platform encoders (MediaFoundation on
 * Windows, AudioToolbox on macOS) and is typically unavailable on Linux, so
 * support is probed at runtime with a real test encode. When unavailable we
 * fall back to a single MP3 (lamejs) with ID3v2 CTOC/CHAP chapters and an
 * APIC cover — still one file with working chapters + cover.
 */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { buildId3v2Tag } from "@shared/id3Chapters";
import { buildUdtaAtom, type CoverImage, injectUdtaIntoMoov } from "@shared/mp4Meta";
import { LinearResampler } from "@shared/resample";
import { createEncoder } from "./audioEncode";

const AAC_CODEC = "mp4a.40.2"; // AAC-LC
const AAC_BITRATE = 96_000; // mono speech
/** Common rate platform AAC encoders accept even when 24 kHz is rejected. */
const AAC_FALLBACK_RATE = 48_000;

export type ChapterMark = {
	title: string;
	/** First PCM sample index of this chapter within the whole book. */
	startSample: number;
};

export type BookMeta = {
	title: string;
	artist?: string;
	chapters: ChapterMark[];
	cover: CoverImage | null;
};

export interface SingleFileEncoder {
	/** Output container/extension this encoder produces. */
	readonly ext: "m4b" | "mp3";
	append(pcm: Float32Array): void;
	finish(meta: BookMeta): Promise<Uint8Array>;
}

function aacConfig(sampleRate: number): AudioEncoderConfig {
	return {
		codec: AAC_CODEC,
		sampleRate,
		numberOfChannels: 1,
		bitrate: AAC_BITRATE,
	};
}

/**
 * True if this Chromium can actually encode AAC at the given sample rate.
 * Does a real one-frame encode: `isConfigSupported` alone can report support
 * while the underlying platform encoder fails on first use.
 */
async function probeAacEncode(sampleRate: number): Promise<boolean> {
	try {
		if (typeof AudioEncoder === "undefined") return false;
		const support = await AudioEncoder.isConfigSupported(aacConfig(sampleRate));
		if (!support.supported) return false;
		let outputs = 0;
		let failed = false;
		const enc = new AudioEncoder({
			output: () => {
				outputs++;
			},
			error: () => {
				failed = true;
			},
		});
		enc.configure(aacConfig(sampleRate));
		const frames = 1024;
		const data = new AudioData({
			format: "f32",
			sampleRate,
			numberOfChannels: 1,
			numberOfFrames: frames,
			timestamp: 0,
			data: new Float32Array(frames),
		});
		enc.encode(data);
		data.close();
		await enc.flush();
		enc.close();
		return !failed && outputs > 0;
	} catch {
		return false;
	}
}

const aacProbeCache = new Map<number, Promise<boolean>>();

/** Kokoro synthesizes at 24 kHz; used for the UI probe before any PCM exists. */
export const DEFAULT_SAMPLE_RATE = 24_000;

export function canEncodeAac(
	sampleRate: number = DEFAULT_SAMPLE_RATE,
): Promise<boolean> {
	let cached = aacProbeCache.get(sampleRate);
	if (!cached) {
		cached = probeAacEncode(sampleRate);
		aacProbeCache.set(sampleRate, cached);
	}
	return cached;
}

/** Whether choosing "M4B" will really produce an .m4b (vs the MP3 fallback). */
export async function canExportM4b(): Promise<boolean> {
	return (
		(await canEncodeAac(DEFAULT_SAMPLE_RATE)) ||
		(await canEncodeAac(AAC_FALLBACK_RATE))
	);
}

function marksToSeconds(
	chapters: ChapterMark[],
	sampleRate: number,
): { title: string; startSeconds: number }[] {
	return chapters.map((c) => ({
		title: c.title,
		startSeconds: c.startSample / sampleRate,
	}));
}

/** AAC-LC in MP4 (.m4b) with Nero chapters + iTunes title/cover atoms. */
class AacM4bEncoder implements SingleFileEncoder {
	readonly ext = "m4b" as const;
	private muxer: Muxer<ArrayBufferTarget>;
	private encoder: AudioEncoder;
	/** Upsamples when the platform AAC encoder rejects the synthesis rate. */
	private resampler: LinearResampler | null;
	private encodedSamples = 0;
	private encodeError: DOMException | null = null;

	constructor(
		/** Rate of the PCM fed to append() — also the unit of ChapterMarks. */
		private readonly inputRate: number,
		/** Rate the AAC encoder actually runs at (== inputRate when supported). */
		private readonly encodeRate: number,
	) {
		this.resampler =
			encodeRate === inputRate
				? null
				: new LinearResampler(inputRate, encodeRate);
		this.muxer = new Muxer({
			target: new ArrayBufferTarget(),
			audio: { codec: "aac", numberOfChannels: 1, sampleRate: encodeRate },
			// moov-last layout: required so injecting udta into moov afterwards
			// can't shift mdat (which would break stco chunk offsets).
			fastStart: false,
		});
		this.encoder = new AudioEncoder({
			output: (chunk, meta) => this.muxer.addAudioChunk(chunk, meta),
			error: (e) => {
				this.encodeError = e;
			},
		});
		this.encoder.configure(aacConfig(encodeRate));
	}

	append(pcm: Float32Array): void {
		if (this.encodeError) return; // surfaced in finish()
		const samples = this.resampler ? this.resampler.process(pcm) : pcm;
		if (samples.length === 0) return;
		const data = new AudioData({
			format: "f32",
			sampleRate: this.encodeRate,
			numberOfChannels: 1,
			numberOfFrames: samples.length,
			timestamp: Math.round(
				(this.encodedSamples / this.encodeRate) * 1_000_000,
			),
			data: samples as Float32Array<ArrayBuffer>,
		});
		this.encoder.encode(data);
		data.close();
		this.encodedSamples += samples.length;
	}

	async finish(meta: BookMeta): Promise<Uint8Array> {
		await this.encoder.flush();
		if (this.encodeError) {
			throw new Error(`AAC encoding failed: ${this.encodeError.message}`);
		}
		this.encoder.close();
		this.muxer.finalize();
		const mp4 = new Uint8Array(this.muxer.target.buffer);
		const udta = buildUdtaAtom({
			title: meta.title,
			artist: meta.artist,
			chapters: marksToSeconds(meta.chapters, this.inputRate),
			cover: meta.cover,
		});
		return injectUdtaIntoMoov(mp4, udta);
	}
}

/** Fallback: one MP3 with an ID3v2 tag carrying CTOC/CHAP chapters + cover. */
class Mp3ChapterEncoder implements SingleFileEncoder {
	readonly ext = "mp3" as const;
	private readonly mp3: ReturnType<typeof createEncoder>;
	private samples = 0;

	constructor(private readonly sampleRate: number) {
		this.mp3 = createEncoder("mp3", sampleRate);
	}

	append(pcm: Float32Array): void {
		this.mp3.append(pcm);
		this.samples += pcm.length;
	}

	async finish(meta: BookMeta): Promise<Uint8Array> {
		const audio = this.mp3.finish();
		const totalMs = (this.samples / this.sampleRate) * 1000;
		const marks = meta.chapters;
		const tag = buildId3v2Tag({
			title: meta.title,
			artist: meta.artist,
			cover: meta.cover,
			chapters: marks.map((c, i) => ({
				title: c.title,
				startMs: (c.startSample / this.sampleRate) * 1000,
				endMs:
					i + 1 < marks.length
						? (marks[i + 1]!.startSample / this.sampleRate) * 1000
						: totalMs,
			})),
		});
		const out = new Uint8Array(tag.length + audio.length);
		out.set(tag, 0);
		out.set(audio, tag.length);
		return out;
	}
}

/**
 * M4B when this platform can encode AAC — at the native rate if possible,
 * otherwise upsampled to 48 kHz (e.g. Windows MediaFoundation only accepts
 * 44.1/48 kHz input). When AAC isn't available at all (typically Linux),
 * falls back to a single MP3 with ID3 chapters.
 */
export async function createSingleFileEncoder(
	sampleRate: number,
): Promise<SingleFileEncoder> {
	if (await canEncodeAac(sampleRate)) {
		return new AacM4bEncoder(sampleRate, sampleRate);
	}
	if (sampleRate !== AAC_FALLBACK_RATE && (await canEncodeAac(AAC_FALLBACK_RATE))) {
		return new AacM4bEncoder(sampleRate, AAC_FALLBACK_RATE);
	}
	return new Mp3ChapterEncoder(sampleRate);
}
