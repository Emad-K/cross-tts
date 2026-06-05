import { Mp3Encoder } from "@breezystack/lamejs";
import type { AudioFormat } from "@shared/audiobook";

/** Streaming audio encoder: feed PCM chunks, get the finished file bytes. */
export interface AudioEncoder {
	append(pcm: Float32Array): void;
	finish(): Uint8Array;
}

function floatToInt16(input: Float32Array): Int16Array {
	const out = new Int16Array(input.length);
	for (let i = 0; i < input.length; i++) {
		const s = Math.max(-1, Math.min(1, input[i]!));
		out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return out;
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
	const out = new Uint8Array(total);
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
	private total = 0;

	constructor(sampleRate: number, kbps = 128) {
		this.enc = new Mp3Encoder(1, sampleRate, kbps);
	}

	append(pcm: Float32Array): void {
		const i16 = floatToInt16(pcm);
		const BLOCK = 1152;
		for (let i = 0; i < i16.length; i += BLOCK) {
			const block = i16.subarray(i, i + BLOCK);
			const mp3 = this.enc.encodeBuffer(block);
			if (mp3.length > 0) {
				this.parts.push(mp3);
				this.total += mp3.length;
			}
		}
	}

	finish(): Uint8Array {
		const end = this.enc.flush();
		if (end.length > 0) {
			this.parts.push(end);
			this.total += end.length;
		}
		return concat(this.parts, this.total);
	}
}

/** 16-bit mono PCM WAV. Accumulates samples, writes the header at the end. */
class WavEncoder implements AudioEncoder {
	private chunks: Int16Array[] = [];
	private samples = 0;

	constructor(private readonly sampleRate: number) {}

	append(pcm: Float32Array): void {
		const i16 = floatToInt16(pcm);
		this.chunks.push(i16);
		this.samples += i16.length;
	}

	finish(): Uint8Array {
		const dataBytes = this.samples * 2;
		const buffer = new ArrayBuffer(44 + dataBytes);
		const view = new DataView(buffer);
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
		view.setUint32(24, this.sampleRate, true);
		view.setUint32(28, this.sampleRate * 2, true); // byte rate
		view.setUint16(32, 2, true); // block align
		view.setUint16(34, 16, true); // bits per sample
		writeStr(36, "data");
		view.setUint32(40, dataBytes, true);
		let offset = 44;
		for (const chunk of this.chunks) {
			for (let i = 0; i < chunk.length; i++) {
				view.setInt16(offset, chunk[i]!, true);
				offset += 2;
			}
		}
		return new Uint8Array(buffer);
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
