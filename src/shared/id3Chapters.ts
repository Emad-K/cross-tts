/**
 * Pure ID3v2.3 tag builder with chapter support (no DOM/Node — bun-testable).
 *
 * Used by the single-file MP3 fallback when AAC encoding isn't available:
 * the tag carries CTOC/CHAP chapter frames (the "ID3v2 Chapter Frame
 * Addendum", read by VLC, Apple Podcasts-style players, etc.), an APIC cover
 * and TIT2/TPE1 title/artist. Prepend the returned bytes to MP3 audio data.
 */

import type { CoverImage } from "./mp4Meta";

export type Id3Chapter = {
	title: string;
	startMs: number;
	endMs: number;
};

export type Id3Meta = {
	title: string;
	artist?: string;
	chapters: Id3Chapter[];
	cover?: CoverImage | null;
};

function ascii(s: string): Uint8Array {
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7f;
	return out;
}

/** UTF-16LE with BOM (text encoding 0x01 — the Unicode option in ID3v2.3). */
function utf16(s: string): Uint8Array {
	const out = new Uint8Array(2 + s.length * 2);
	out[0] = 0xff;
	out[1] = 0xfe;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		out[2 + i * 2] = c & 0xff;
		out[3 + i * 2] = (c >>> 8) & 0xff;
	}
	return out;
}

function u32be(n: number): Uint8Array {
	return new Uint8Array([
		(n >>> 24) & 0xff,
		(n >>> 16) & 0xff,
		(n >>> 8) & 0xff,
		n & 0xff,
	]);
}

/** 28-bit syncsafe integer (7 bits per byte), used for the tag size. */
export function syncsafe(n: number): Uint8Array {
	if (n < 0 || n >= 1 << 28) throw new Error(`Value out of syncsafe range: ${n}`);
	return new Uint8Array([
		(n >>> 21) & 0x7f,
		(n >>> 14) & 0x7f,
		(n >>> 7) & 0x7f,
		n & 0x7f,
	]);
}

export function readSyncsafe(bytes: Uint8Array, off: number): number {
	return (
		((bytes[off]! & 0x7f) << 21) |
		((bytes[off + 1]! & 0x7f) << 14) |
		((bytes[off + 2]! & 0x7f) << 7) |
		(bytes[off + 3]! & 0x7f)
	);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

/** ID3v2.3 frame: 4-char id, u32 size (payload only, not syncsafe), u16 flags. */
function frame(id: string, ...payload: Uint8Array[]): Uint8Array {
	const body = concatBytes(payload);
	return concatBytes([ascii(id), u32be(body.length), new Uint8Array(2), body]);
}

const ENC_UTF16 = new Uint8Array([0x01]);
const ENC_LATIN1 = new Uint8Array([0x00]);
const NUL = new Uint8Array([0x00]);

function textFrame(id: string, value: string): Uint8Array {
	return frame(id, ENC_UTF16, utf16(value));
}

function apicFrame(cover: CoverImage): Uint8Array {
	return frame(
		"APIC",
		ENC_LATIN1,
		ascii(cover.mime),
		NUL, // mime terminator
		new Uint8Array([0x03]), // picture type: front cover
		NUL, // empty description (latin-1 terminator)
		cover.data,
	);
}

function chapElementId(index: number): string {
	return `ch${String(index + 1).padStart(3, "0")}`;
}

function chapFrame(elementId: string, ch: Id3Chapter): Uint8Array {
	return frame(
		"CHAP",
		ascii(elementId),
		NUL,
		u32be(Math.max(0, Math.round(ch.startMs))),
		u32be(Math.max(0, Math.round(ch.endMs))),
		u32be(0xffffffff), // start byte offset: not used
		u32be(0xffffffff), // end byte offset: not used
		textFrame("TIT2", ch.title), // embedded sub-frame with the chapter title
	);
}

function ctocFrame(elementIds: string[]): Uint8Array {
	const entries = elementIds.map((id) => concatBytes([ascii(id), NUL]));
	return frame(
		"CTOC",
		ascii("toc"),
		NUL,
		new Uint8Array([0x03]), // flags: top-level + ordered
		new Uint8Array([elementIds.length]),
		...entries,
	);
}

/**
 * Build a complete ID3v2.3 tag (header + frames). Prepend to MP3 bytes.
 * Chapters beyond 255 are dropped (CTOC's entry count is a single byte).
 */
export function buildId3v2Tag(meta: Id3Meta): Uint8Array {
	const chapters = meta.chapters.slice(0, 255);
	const ids = chapters.map((_, i) => chapElementId(i));
	const frames: Uint8Array[] = [textFrame("TIT2", meta.title)];
	if (meta.artist) frames.push(textFrame("TPE1", meta.artist));
	if (chapters.length > 0) {
		frames.push(ctocFrame(ids));
		for (let i = 0; i < chapters.length; i++) {
			frames.push(chapFrame(ids[i]!, chapters[i]!));
		}
	}
	if (meta.cover && meta.cover.data.length > 0) {
		frames.push(apicFrame(meta.cover));
	}
	const body = concatBytes(frames);
	const header = concatBytes([
		ascii("ID3"),
		new Uint8Array([0x03, 0x00]), // version 2.3.0
		new Uint8Array([0x00]), // flags
		syncsafe(body.length),
	]);
	return concatBytes([header, body]);
}
