import { describe, expect, test } from "bun:test";
import {
	buildId3v2Tag,
	readSyncsafe,
	syncsafe,
} from "./id3Chapters";

function u32At(bytes: Uint8Array, off: number): number {
	return (
		((bytes[off]! << 24) |
			(bytes[off + 1]! << 16) |
			(bytes[off + 2]! << 8) |
			bytes[off + 3]!) >>>
		0
	);
}

function asciiAt(bytes: Uint8Array, off: number, len: number): string {
	return String.fromCharCode(...bytes.subarray(off, off + len));
}

/** Minimal ID3v2.3 frame walker for assertions. */
function parseFrames(
	tag: Uint8Array,
	start: number,
	end: number,
): { id: string; payload: Uint8Array }[] {
	const out: { id: string; payload: Uint8Array }[] = [];
	let off = start;
	while (off + 10 <= end) {
		const id = asciiAt(tag, off, 4);
		if (!/^[A-Z0-9]{4}$/.test(id)) break;
		const size = u32At(tag, off + 4);
		out.push({ id, payload: tag.subarray(off + 10, off + 10 + size) });
		off += 10 + size;
	}
	return out;
}

function decodeUtf16Frame(payload: Uint8Array): string {
	expect(payload[0]).toBe(0x01); // UTF-16 with BOM
	expect(payload[1]).toBe(0xff);
	expect(payload[2]).toBe(0xfe);
	return new TextDecoder("utf-16le").decode(payload.subarray(3));
}

describe("syncsafe", () => {
	test("roundtrips and keeps the high bit of every byte clear", () => {
		for (const n of [0, 1, 127, 128, 255, 0x0fffffff]) {
			const b = syncsafe(n);
			expect(b.length).toBe(4);
			for (const byte of b) expect(byte & 0x80).toBe(0);
			expect(readSyncsafe(b, 0)).toBe(n);
		}
	});

	test("rejects out-of-range values", () => {
		expect(() => syncsafe(1 << 28)).toThrow();
		expect(() => syncsafe(-1)).toThrow();
	});
});

describe("buildId3v2Tag", () => {
	const cover = {
		data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
		mime: "image/jpeg",
	};
	const tag = buildId3v2Tag({
		title: "My Bóok",
		artist: "An Author",
		chapters: [
			{ title: "Intro", startMs: 0, endMs: 61_500 },
			{ title: "Chapter Two", startMs: 61_500, endMs: 120_000 },
		],
		cover,
	});

	test("header: ID3 v2.3, syncsafe size matches body length", () => {
		expect(asciiAt(tag, 0, 3)).toBe("ID3");
		expect(tag[3]).toBe(0x03);
		expect(tag[4]).toBe(0x00);
		expect(tag[5]).toBe(0x00); // flags
		expect(readSyncsafe(tag, 6)).toBe(tag.length - 10);
	});

	test("TIT2/TPE1 are UTF-16 text frames", () => {
		const frames = parseFrames(tag, 10, tag.length);
		const tit2 = frames.find((f) => f.id === "TIT2")!;
		expect(decodeUtf16Frame(tit2.payload)).toBe("My Bóok");
		const tpe1 = frames.find((f) => f.id === "TPE1")!;
		expect(decodeUtf16Frame(tpe1.payload)).toBe("An Author");
	});

	test("CTOC lists chapter element ids in order, top-level + ordered flags", () => {
		const frames = parseFrames(tag, 10, tag.length);
		const ctoc = frames.find((f) => f.id === "CTOC")!;
		const p = ctoc.payload;
		// element id "toc" + NUL
		expect(asciiAt(p, 0, 3)).toBe("toc");
		expect(p[3]).toBe(0);
		expect(p[4]).toBe(0x03); // flags
		expect(p[5]).toBe(2); // entry count
		expect(asciiAt(p, 6, 5)).toBe("ch001");
		expect(p[11]).toBe(0);
		expect(asciiAt(p, 12, 5)).toBe("ch002");
		expect(p[17]).toBe(0);
	});

	test("CHAP frames carry times, 0xFFFFFFFF offsets and a TIT2 sub-frame", () => {
		const frames = parseFrames(tag, 10, tag.length);
		const chaps = frames.filter((f) => f.id === "CHAP");
		expect(chaps.length).toBe(2);

		const p = chaps[1]!.payload;
		expect(asciiAt(p, 0, 5)).toBe("ch002");
		expect(p[5]).toBe(0);
		expect(u32At(p, 6)).toBe(61_500);
		expect(u32At(p, 10)).toBe(120_000);
		expect(u32At(p, 14)).toBe(0xffffffff);
		expect(u32At(p, 18)).toBe(0xffffffff);

		const sub = parseFrames(p, 22, p.length);
		expect(sub.length).toBe(1);
		expect(sub[0]!.id).toBe("TIT2");
		expect(decodeUtf16Frame(sub[0]!.payload)).toBe("Chapter Two");
	});

	test("APIC embeds the cover with mime and front-cover type", () => {
		const frames = parseFrames(tag, 10, tag.length);
		const apic = frames.find((f) => f.id === "APIC")!;
		const p = apic.payload;
		expect(p[0]).toBe(0x00); // latin-1 description
		const mimeEnd = p.indexOf(0, 1);
		expect(asciiAt(p, 1, mimeEnd - 1)).toBe("image/jpeg");
		expect(p[mimeEnd + 1]).toBe(0x03); // front cover
		expect(p[mimeEnd + 2]).toBe(0x00); // empty description
		expect([...p.subarray(mimeEnd + 3)]).toEqual([...cover.data]);
	});

	test("no chapters → no CTOC/CHAP; no cover → no APIC", () => {
		const bare = buildId3v2Tag({ title: "T", chapters: [] });
		const frames = parseFrames(bare, 10, bare.length);
		expect(frames.map((f) => f.id)).toEqual(["TIT2"]);
	});

	test("clamps to 255 chapters", () => {
		const many = buildId3v2Tag({
			title: "T",
			chapters: Array.from({ length: 300 }, (_, i) => ({
				title: `c${i}`,
				startMs: i * 1000,
				endMs: (i + 1) * 1000,
			})),
		});
		const frames = parseFrames(many, 10, many.length);
		expect(frames.filter((f) => f.id === "CHAP").length).toBe(255);
		const ctoc = frames.find((f) => f.id === "CTOC")!;
		expect(ctoc.payload[5]).toBe(255);
	});
});
