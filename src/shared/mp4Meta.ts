/**
 * Pure MP4/M4B metadata atom builders (no DOM, no Node APIs — bun-testable).
 *
 * Adds what mp4-muxer doesn't emit natively:
 * - Nero chapter markers: `moov.udta.chpl` (read by VLC, mp4chaps, most
 *   audiobook players).
 * - iTunes-style metadata: `moov.udta.meta.ilst` with `©nam` (title),
 *   `©ART` (artist) and `covr` (cover art).
 *
 * The udta box is appended to the end of an existing `moov`. This is only
 * safe when `moov` comes after `mdat` (moov-last layout, e.g. mp4-muxer with
 * `fastStart: false`); growing a moov that precedes mdat would shift media
 * data and break stco/co64 chunk offsets.
 */

export type Mp4Chapter = { title: string; startSeconds: number };
export type CoverImage = { data: Uint8Array; mime: string };

export type M4bMeta = {
	title: string;
	artist?: string;
	chapters: Mp4Chapter[];
	cover?: CoverImage | null;
};

const utf8 = new TextEncoder();

function u8(n: number): Uint8Array {
	return new Uint8Array([n & 0xff]);
}

function u32(n: number): Uint8Array {
	return new Uint8Array([
		(n >>> 24) & 0xff,
		(n >>> 16) & 0xff,
		(n >>> 8) & 0xff,
		n & 0xff,
	]);
}

/** Big-endian u64 from a JS number (safe for values < 2^53). */
function u64(n: number): Uint8Array {
	const hi = Math.floor(n / 0x100000000);
	const lo = n >>> 0;
	const out = new Uint8Array(8);
	out.set(u32(hi), 0);
	out.set(u32(lo), 4);
	return out;
}

/** Four-character code → bytes ('©' maps to 0xA9 as in real iTunes atoms). */
function fourcc(type: string): Uint8Array {
	if (type.length !== 4) throw new Error(`fourcc must be 4 chars: ${type}`);
	const out = new Uint8Array(4);
	for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i) & 0xff;
	return out;
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

/** MP4 box: 4-byte big-endian size (incl. header) + fourcc + payload. */
export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
	let payload = 0;
	for (const p of parts) payload += p.length;
	return concatBytes([u32(8 + payload), fourcc(type), ...parts]);
}

/** UTF-8 encode, truncated to maxBytes without splitting a code point. */
function utf8Clamped(s: string, maxBytes: number): Uint8Array {
	let bytes = utf8.encode(s);
	if (bytes.length <= maxBytes) return bytes;
	let end = maxBytes;
	// Back up over UTF-8 continuation bytes so we don't cut mid-codepoint.
	while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
	return bytes.slice(0, end);
}

/**
 * Nero chapter atom (`chpl`), matching what ffmpeg writes:
 * version 1 + flags 0, u32 reserved, u8 count, then per chapter a u64
 * timestamp in 100-nanosecond units, u8 title byte-length, UTF-8 title.
 */
export function buildChplAtom(chapters: Mp4Chapter[]): Uint8Array {
	const list = chapters.slice(0, 255);
	const parts: Uint8Array[] = [
		new Uint8Array([1, 0, 0, 0]), // version 1, flags 0
		u32(0), // reserved
		u8(list.length),
	];
	for (const ch of list) {
		const title = utf8Clamped(ch.title, 255);
		parts.push(u64(Math.round(ch.startSeconds * 10_000_000)));
		parts.push(u8(title.length));
		parts.push(title);
	}
	return box("chpl", ...parts);
}

/** iTunes data box: u32 type indicator + u32 locale(0) + payload. */
function ilstDataBox(typeIndicator: number, payload: Uint8Array): Uint8Array {
	return box("data", u32(typeIndicator), u32(0), payload);
}

const ILST_TYPE_UTF8 = 1;
const ILST_TYPE_JPEG = 13;
const ILST_TYPE_PNG = 14;

function ilstTextItem(fourCc: string, value: string): Uint8Array {
	return box(fourCc, ilstDataBox(ILST_TYPE_UTF8, utf8.encode(value)));
}

function coverTypeIndicator(mime: string): number {
	return /png/i.test(mime) ? ILST_TYPE_PNG : ILST_TYPE_JPEG;
}

/** `hdlr` for the iTunes metadata box (handler 'mdir', manufacturer 'appl'). */
function metaHdlrBox(): Uint8Array {
	return box(
		"hdlr",
		u32(0), // version + flags
		u32(0), // pre_defined
		fourcc("mdir"),
		fourcc("appl"),
		u32(0),
		u32(0),
		u8(0), // empty null-terminated name
	);
}

/**
 * Build a complete `udta` box holding Nero chapters (`chpl`) and iTunes
 * metadata (`meta` → `hdlr` + `ilst` with ©nam/©ART/covr).
 */
export function buildUdtaAtom(meta: M4bMeta): Uint8Array {
	const ilstItems: Uint8Array[] = [ilstTextItem("©nam", meta.title)];
	if (meta.artist) ilstItems.push(ilstTextItem("©ART", meta.artist));
	if (meta.cover && meta.cover.data.length > 0) {
		ilstItems.push(
			box(
				"covr",
				ilstDataBox(coverTypeIndicator(meta.cover.mime), meta.cover.data),
			),
		);
	}
	const metaBox = box(
		"meta",
		u32(0), // FullBox version + flags
		metaHdlrBox(),
		box("ilst", ...ilstItems),
	);
	const children: Uint8Array[] = [];
	if (meta.chapters.length > 0) children.push(buildChplAtom(meta.chapters));
	children.push(metaBox);
	return box("udta", ...children);
}

function readU32(bytes: Uint8Array, off: number): number {
	return (
		((bytes[off]! << 24) |
			(bytes[off + 1]! << 16) |
			(bytes[off + 2]! << 8) |
			bytes[off + 3]!) >>>
		0
	);
}

function boxType(bytes: Uint8Array, off: number): string {
	return String.fromCharCode(
		bytes[off + 4]!,
		bytes[off + 5]!,
		bytes[off + 6]!,
		bytes[off + 7]!,
	);
}

export type Mp4Box = {
	/** Offset of the box header within the searched range's buffer. */
	start: number;
	/** Offset one past the box's last byte. */
	end: number;
	/** Offset of the first payload byte (after size + fourcc). */
	payloadStart: number;
	type: string;
};

/** Iterate sibling boxes in bytes[start, end). Throws on 64-bit sizes. */
export function* iterBoxes(
	bytes: Uint8Array,
	start = 0,
	end = bytes.length,
): Generator<Mp4Box> {
	let off = start;
	while (off + 8 <= end) {
		let size = readU32(bytes, off);
		const type = boxType(bytes, off);
		if (size === 1) throw new Error(`64-bit box size not supported (${type})`);
		if (size === 0) size = end - off; // box extends to end of range
		if (size < 8 || off + size > end) {
			throw new Error(`Malformed box ${type} at offset ${off}`);
		}
		yield { start: off, end: off + size, payloadStart: off + 8, type };
		off += size;
	}
}

/** Find the first box following a type path (e.g. ["moov","udta","chpl"]). */
export function findBox(
	bytes: Uint8Array,
	path: string[],
	start = 0,
	end = bytes.length,
): Mp4Box | null {
	if (path.length === 0) return null;
	for (const b of iterBoxes(bytes, start, end)) {
		if (b.type !== path[0]) continue;
		if (path.length === 1) return b;
		// `meta` is a FullBox: children start after its 4-byte version/flags.
		const skip = b.type === "meta" ? 4 : 0;
		return findBox(bytes, path.slice(1), b.payloadStart + skip, b.end);
	}
	return null;
}

/**
 * Append a `udta` box to the end of the top-level `moov` and patch the moov
 * size. The rest of the file is byte-identical. Only valid for moov-last
 * files (see module docs).
 */
export function injectUdtaIntoMoov(
	mp4: Uint8Array,
	udta: Uint8Array,
): Uint8Array {
	let moov: Mp4Box | null = null;
	for (const b of iterBoxes(mp4)) {
		if (b.type === "moov") {
			moov = b;
			break;
		}
	}
	if (!moov) throw new Error("No moov box found in MP4 data");

	const out = new Uint8Array(mp4.length + udta.length);
	out.set(mp4.subarray(0, moov.end), 0);
	out.set(udta, moov.end);
	out.set(mp4.subarray(moov.end), moov.end + udta.length);
	// Patch the moov size (also turns an implicit to-EOF size into an explicit one).
	out.set(u32(moov.end - moov.start + udta.length), moov.start);
	return out;
}
