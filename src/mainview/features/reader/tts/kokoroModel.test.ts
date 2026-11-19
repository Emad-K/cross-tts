import { describe, expect, test } from "bun:test";
import { styleOffset, voiceLoader } from "./kokoroModel";

describe("styleOffset", () => {
	test("indexes the style vector by token count minus BOS/EOS", () => {
		expect(styleOffset(0)).toBe(0);
		expect(styleOffset(2)).toBe(0);
		expect(styleOffset(3)).toBe(256);
		expect(styleOffset(102)).toBe(100 * 256);
	});

	test("clamps to the last of the voice's 510 vectors", () => {
		expect(styleOffset(511)).toBe(509 * 256);
		expect(styleOffset(512)).toBe(509 * 256);
	});
});

describe("voiceLoader", () => {
	test("fetches each voice once and retries after a failure", async () => {
		let calls = 0;
		let fail = true;
		const load = voiceLoader(async () => {
			calls++;
			if (fail) throw new Error("offline");
			return new Float32Array([1, 2]).buffer;
		});
		await expect(load("af_heart")).rejects.toThrow("offline");
		fail = false;
		expect(Array.from(await load("af_heart"))).toEqual([1, 2]);
		await load("af_heart");
		expect(calls).toBe(2);
	});
});
