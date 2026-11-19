import { describe, expect, test } from "bun:test";
import { concat, WAV_MAX_DATA_BYTES, WavEncoder } from "./audioEncode";

describe("WavEncoder", () => {
	test("writes a valid 16-bit mono header and little-endian samples", () => {
		const enc = new WavEncoder(24000);
		enc.append(new Float32Array([0, 1, -1]));
		enc.append(new Float32Array([0.5]));
		const bytes = concat(enc.finish());
		const view = new DataView(bytes.buffer);
		const str = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));

		expect(bytes.length).toBe(44 + 8);
		expect(str(0)).toBe("RIFF");
		expect(view.getUint32(4, true)).toBe(36 + 8);
		expect(str(8)).toBe("WAVE");
		expect(str(12)).toBe("fmt ");
		expect(view.getUint32(16, true)).toBe(16);
		expect(view.getUint16(20, true)).toBe(1); // PCM
		expect(view.getUint16(22, true)).toBe(1); // mono
		expect(view.getUint32(24, true)).toBe(24000);
		expect(view.getUint32(28, true)).toBe(48000);
		expect(view.getUint16(32, true)).toBe(2);
		expect(view.getUint16(34, true)).toBe(16);
		expect(str(36)).toBe("data");
		expect(view.getUint32(40, true)).toBe(8);
		expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
			0, 0x7fff, -0x8000, Math.trunc(0.5 * 0x7fff),
		]);
	});

	test("refuses to grow past the 4 GiB RIFF limit", () => {
		const enc = new WavEncoder(24000);
		// Pretend we're already just under the limit without allocating 4 GiB.
		(enc as unknown as { dataBytes: number }).dataBytes = WAV_MAX_DATA_BYTES - 2;
		expect(() => enc.append(new Float32Array(2))).toThrow(/4 GiB/);
	});
});
