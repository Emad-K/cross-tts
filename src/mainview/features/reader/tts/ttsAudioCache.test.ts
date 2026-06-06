import { describe, expect, test } from "bun:test";
import { AudioCache, audioCacheKey } from "./ttsAudioCache";

describe("audioCacheKey", () => {
	test("differs by voice, speed, rules, and text", () => {
		const base = audioCacheKey("hello", "af_heart", 1, "sig");
		expect(audioCacheKey("hello", "am_other", 1, "sig")).not.toBe(base);
		expect(audioCacheKey("hello", "af_heart", 1.5, "sig")).not.toBe(base);
		expect(audioCacheKey("hello", "af_heart", 1, "sig2")).not.toBe(base);
		expect(audioCacheKey("world", "af_heart", 1, "sig")).not.toBe(base);
	});

	test("is stable for identical inputs", () => {
		expect(audioCacheKey("hello", "af_heart", 1, "sig")).toBe(
			audioCacheKey("hello", "af_heart", 1, "sig"),
		);
	});
});

describe("AudioCache", () => {
	test("caches a result and reports has()", async () => {
		const cache = new AudioCache<string>(4);
		let calls = 0;
		const factory = async () => {
			calls += 1;
			return "v";
		};
		expect(cache.has("k")).toBe(false);
		expect(await cache.getOrCreate("k", factory)).toBe("v");
		expect(cache.has("k")).toBe(true);
		expect(await cache.getOrCreate("k", factory)).toBe("v");
		expect(calls).toBe(1);
	});

	test("de-duplicates concurrent in-flight requests", async () => {
		const cache = new AudioCache<string>(4);
		let calls = 0;
		let release: (v: string) => void = () => {};
		const factory = () => {
			calls += 1;
			return new Promise<string>((r) => {
				release = r;
			});
		};
		const a = cache.getOrCreate("k", factory);
		const b = cache.getOrCreate("k", factory);
		expect(calls).toBe(1);
		release("v");
		expect(await a).toBe("v");
		expect(await b).toBe("v");
	});

	test("evicts least-recently-used past the bound", async () => {
		const cache = new AudioCache<string>(2);
		await cache.getOrCreate("a", async () => "a");
		await cache.getOrCreate("b", async () => "b");
		// Touch "a" so "b" becomes least-recently-used.
		await cache.getOrCreate("a", async () => "a");
		await cache.getOrCreate("c", async () => "c");
		expect(cache.has("b")).toBe(false);
		expect(cache.has("a")).toBe(true);
		expect(cache.has("c")).toBe(true);
		expect(cache.size).toBe(2);
	});

	test("does not cache a thrown factory; retries next call", async () => {
		const cache = new AudioCache<string>(4);
		let calls = 0;
		const factory = async () => {
			calls += 1;
			if (calls === 1) throw new Error("boom");
			return "ok";
		};
		await expect(cache.getOrCreate("k", factory)).rejects.toThrow("boom");
		expect(cache.has("k")).toBe(false);
		expect(await cache.getOrCreate("k", factory)).toBe("ok");
		expect(calls).toBe(2);
	});

	test("caches a null result (e.g. an empty chunk)", async () => {
		const cache = new AudioCache<string>(4);
		let calls = 0;
		const factory = async () => {
			calls += 1;
			return null;
		};
		expect(await cache.getOrCreate("k", factory)).toBe(null);
		expect(cache.has("k")).toBe(true);
		expect(await cache.getOrCreate("k", factory)).toBe(null);
		expect(calls).toBe(1);
	});

	test("clear() drops everything", async () => {
		const cache = new AudioCache<string>(4);
		await cache.getOrCreate("k", async () => "v");
		cache.clear();
		expect(cache.has("k")).toBe(false);
		expect(cache.size).toBe(0);
	});
});
