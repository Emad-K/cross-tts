import { Mp3Encoder } from "@breezystack/lamejs";
import type { AudioFormat } from "@shared/audiobook";

/**
 * Streaming audio encoder: feed PCM chunks, get the finished file as a list of
 * byte parts (write them in order). Parts avoid one giant concatenated copy.
 */
export interface AudioEncoder {
	append(pcm: Float32Array): void;
	finish(): Uint8Array[];
}

function floatToInt16(input: Float32Array): Int16Array {
	const out = new Int16Array(input.length);
	for (let i = 0; i < input.length; i++) {
		const s = Math.max(-1, Math.min(1, input[i]!));
		out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}

/** MP3 via lamejs — encoded incrementally so we never hold a whole chapter in PCM. */
class Mp3StreamEncoder implements AudioEncoder {
	private enc: Mp3Encoder;
	private parts: Uint8Array[] = [];

	constructor(sampleRate: number, kbps = 128) {
		this.enc = new Mp3Encoder(1, sampleRate, kbps);
	}

	append(pcm: Float32Array): void {
		const i16 = floatToInt16(pcm);
		const BLOCK = 1152;
		for (let i = 0; i < i16.length; i += BLOCK) {
			const block = i16.subarray(i, i + BLOCK);
			const mp3 = this.enc.encodeBuffer(block);
			if (mp3.length > 0) this.parts.push(mp3);
		}
	}

	finish(): Uint8Array[] {
		const end = this.enc.flush();
		if (end.length > 0) this.parts.push(end);
		return this.parts;
	}
}

/** RIFF sizes are 32-bit: the whole file must stay under 4 GiB. */
export const WAV_MAX_DATA_BYTES = 0xffffffff - 36;

/** 44-byte header for 16-bit mono PCM WAV. */
export function wavHeader(sampleRate: number, dataBytes: number): Uint8Array {
	const header = new Uint8Array(44);
	const view = new DataView(header.buffer);
	const writeStr = (offset: number, s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
	};
	writeStr(0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	writeStr(8, "WAVE");
	writeStr(12, "fmt ");
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeStr(36, "data");
	view.setUint32(40, dataBytes, true);
	return header;
}

/**
 * 16-bit mono PCM WAV. Keeps the converted samples once and returns them as
 * zero-copy byte views behind the header (Int16Array memory is little-endian
 * on every platform we ship, matching WAV).
 */
export class WavEncoder implements AudioEncoder {
	private chunks: Int16Array[] = [];
	private dataBytes = 0;

	constructor(private readonly sampleRate: number) {}

	append(pcm: Float32Array): void {
		if (this.dataBytes + pcm.length * 2 > WAV_MAX_DATA_BYTES) {
			// Fail early instead of after hours of synthesis.
			throw new Error(
				"This book is too long for a single WAV file (WAV is limited to 4 GiB, about 24 hours). Export as MP3 or one file per chapter instead.",
			);
		}
		const i16 = floatToInt16(pcm);
		this.chunks.push(i16);
		this.dataBytes += i16.byteLength;
	}

	finish(): Uint8Array[] {
		return [
			wavHeader(this.sampleRate, this.dataBytes),
			...this.chunks.map((c) => new Uint8Array(c.buffer, c.byteOffset, c.byteLength)),
		];
	}
}

export function createEncoder(
	format: AudioFormat,
	sampleRate: number,
): AudioEncoder {
	return format === "wav"
		? new WavEncoder(sampleRate)
		: new Mp3StreamEncoder(sampleRate);
}
