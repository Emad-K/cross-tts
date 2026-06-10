import { describe, expect, test } from "bun:test";
import {
	box,
	buildChplAtom,
	buildUdtaAtom,
	findBox,
	injectUdtaIntoMoov,
	iterBoxes,
} from "./mp4Meta";

function u32At(bytes: Uint8Array, off: number): number {
	return (
		((bytes[off]! << 24) |
			(bytes[off + 1]! << 16) |
			(bytes[off + 2]! << 8) |
			bytes[off + 3]!) >>>
		0
	);
}

function u64At(bytes: Uint8Array, off: number): number {
	return u32At(bytes, off) * 0x100000000 + u32At(bytes, off + 4);
}

function typeAt(bytes: Uint8Array, off: number): string {
	return String.fromCharCode(
		bytes[off + 4]!,
		bytes[off + 5]!,
		bytes[off + 6]!,
		bytes[off + 7]!,
	);
}

describe("box", () => {
	test("writes size + fourcc + payload", () => {
		const b = box("free", new Uint8Array([1, 2, 3]));
		expect(b.length).toBe(11);
		expect(u32At(b, 0)).toBe(11);
		expect(typeAt(b, 0)).toBe("free");
		expect([...b.subarray(8)]).toEqual([1, 2, 3]);
	});

	test("maps © to 0xA9", () => {
		const b = box("©nam");
		expect(b[4]).toBe(0xa9);
		expect(String.fromCharCode(b[5]!, b[6]!, b[7]!)).toBe("nam");
	});
});

describe("buildChplAtom", () => {
	test("ffmpeg-compatible layout: version 1, count, 100ns timestamps, titles", () => {
		const chpl = buildChplAtom([
			{ title: "Intro", startSeconds: 0 },
			{ title: "Chapter Two", startSeconds: 61.5 },
		]);
		expect(typeAt(chpl, 0)).toBe("chpl");
		expect(u32At(chpl, 0)).toBe(chpl.length);
		// FullBox: version 1, flags 0; then u32 reserved; then u8 count.
		expect(chpl[8]).toBe(1);
		expect([...chpl.subarray(9, 12)]).toEqual([0, 0, 0]);
		expect(u32At(chpl, 12)).toBe(0);
		expect(chpl[16]).toBe(2);

		// Chapter 1: u64 timestamp, u8 len, utf8 title.
		let off = 17;
		expect(u64At(chpl, off)).toBe(0);
		off += 8;
		expect(chpl[off]).toBe(5);
		off += 1;
		expect(new TextDecoder().decode(chpl.subarray(off, off + 5))).toBe("Intro");
		off += 5;

		// Chapter 2: 61.5s → 615,000,000 hundred-nanoseconds.
		expect(u64At(chpl, off)).toBe(615_000_000);
		off += 8;
		expect(chpl[off]).toBe("Chapter Two".length);
	});

	test("clamps titles to 255 UTF-8 bytes without splitting code points", () => {
		// "é" is 2 bytes in UTF-8; 200 of them = 400 bytes → must clamp ≤255 on
		// an even boundary.
		const chpl = buildChplAtom([{ title: "é".repeat(200), startSeconds: 1 }]);
		const len = chpl[17 + 8]!;
		expect(len).toBeLessThanOrEqual(255);
		expect(len % 2).toBe(0);
		const text = new TextDecoder("utf-8", { fatal: true }).decode(
			chpl.subarray(17 + 9, 17 + 9 + len),
		);
		expect(text).toBe("é".repeat(len / 2));
	});

	test("clamps chapter count to 255", () => {
		const many = Array.from({ length: 300 }, (_, i) => ({
			title: `c${i}`,
			startSeconds: i,
		}));
		const chpl = buildChplAtom(many);
		expect(chpl[16]).toBe(255);
	});
});

describe("buildUdtaAtom", () => {
	const cover = {
		data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]),
		mime: "image/jpeg",
	};
	const meta = {
		title: "My Book",
		artist: "Some Author",
		chapters: [{ title: "One", startSeconds: 0 }],
		cover,
	};

	test("nests chpl and meta/hdlr/ilst inside udta", () => {
		const udta = buildUdtaAtom(meta);
		expect(typeAt(udta, 0)).toBe("udta");
		expect(u32At(udta, 0)).toBe(udta.length);
		expect(findBox(udta, ["udta", "chpl"])).not.toBeNull();
		const hdlr = findBox(udta, ["udta", "meta", "hdlr"]);
		expect(hdlr).not.toBeNull();
		// handler type 'mdir' at payload + 8 (after version/flags + pre_defined).
		const h = udta.subarray(hdlr!.payloadStart + 8, hdlr!.payloadStart + 12);
		expect(String.fromCharCode(...h)).toBe("mdir");
		expect(findBox(udta, ["udta", "meta", "ilst"])).not.toBeNull();
	});

	test("roundtrips title, artist and cover through ilst data boxes", () => {
		const udta = buildUdtaAtom(meta);
		const ilst = findBox(udta, ["udta", "meta", "ilst"])!;

		const items: Record<string, { type: number; payload: Uint8Array }> = {};
		for (const item of iterBoxes(udta, ilst.payloadStart, ilst.end)) {
			const data = findBox(udta, ["data"], item.payloadStart, item.end)!;
			items[item.type] = {
				type: u32At(udta, data.payloadStart),
				payload: udta.subarray(data.payloadStart + 8, data.end),
			};
		}

		expect(new TextDecoder().decode(items["©nam"]!.payload)).toBe("My Book");
		expect(items["©nam"]!.type).toBe(1); // UTF-8 text
		expect(new TextDecoder().decode(items["©ART"]!.payload)).toBe(
			"Some Author",
		);
		expect(items.covr!.type).toBe(13); // JPEG
		expect([...items.covr!.payload]).toEqual([...cover.data]);
	});

	test("PNG covers get type indicator 14; no chpl when no chapters", () => {
		const udta = buildUdtaAtom({
			title: "T",
			chapters: [],
			cover: { data: new Uint8Array([1]), mime: "image/png" },
		});
		expect(findBox(udta, ["udta", "chpl"])).toBeNull();
		const ilst = findBox(udta, ["udta", "meta", "ilst"])!;
		const covr = findBox(udta, ["covr"], ilst.payloadStart, ilst.end)!;
		const data = findBox(udta, ["data"], covr.payloadStart, covr.end)!;
		expect(u32At(udta, data.payloadStart)).toBe(14);
	});

	test("omits artist and cover when absent", () => {
		const udta = buildUdtaAtom({ title: "T", chapters: [] });
		const ilst = findBox(udta, ["udta", "meta", "ilst"])!;
		expect(findBox(udta, ["©ART"], ilst.payloadStart, ilst.end)).toBeNull();
		expect(findBox(udta, ["covr"], ilst.payloadStart, ilst.end)).toBeNull();
	});
});

describe("injectUdtaIntoMoov", () => {
	test("appends udta inside moov and patches only the moov size", () => {
		const ftyp = box("ftyp", new Uint8Array([1, 2, 3, 4]));
		const mdat = box("mdat", new Uint8Array([9, 9, 9, 9, 9]));
		const mvhd = box("mvhd", new Uint8Array(20));
		const moov = box("moov", mvhd);
		const mp4 = new Uint8Array(ftyp.length + mdat.length + moov.length);
		mp4.set(ftyp, 0);
		mp4.set(mdat, ftyp.length);
		mp4.set(moov, ftyp.length + mdat.length);

		const udta = buildUdtaAtom({
			title: "T",
			chapters: [{ title: "One", startSeconds: 2 }],
		});
		const out = injectUdtaIntoMoov(mp4, udta);

		expect(out.length).toBe(mp4.length + udta.length);
		// Everything before moov is untouched.
		expect([...out.subarray(0, ftyp.length + mdat.length)]).toEqual([
			...mp4.subarray(0, ftyp.length + mdat.length),
		]);
		const moovOff = ftyp.length + mdat.length;
		expect(typeAt(out, moovOff)).toBe("moov");
		expect(u32At(out, moovOff)).toBe(moov.length + udta.length);
		// The udta (with chapters) is discoverable at its standard path.
		const chpl = findBox(out, ["moov", "udta", "chpl"]);
		expect(chpl).not.toBeNull();
		const nam = findBox(out, ["moov", "udta", "meta", "ilst", "©nam"]);
		expect(nam).not.toBeNull();
	});

	test("throws when there is no moov", () => {
		const onlyMdat = box("mdat", new Uint8Array([1]));
		expect(() =>
			injectUdtaIntoMoov(onlyMdat, buildUdtaAtom({ title: "T", chapters: [] })),
		).toThrow();
	});
});
