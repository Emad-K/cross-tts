import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { hubDiskCache } from "./hubDiskCache";

const HUB = "http://127.0.0.1:4000/tok/";
const DIR = "/models";
const ONNX = `${HUB}onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx`;

describe("hubDiskCache", () => {
	test("maps a hub .onnx URL to the hub's file on disk", async () => {
		const cache = hubDiskCache(HUB, DIR, () => true);
		expect(await cache.match(ONNX)).toBe(
			join(DIR, "onnx-community", "Kokoro-82M-v1.0-ONNX", "resolve", "main", "onnx", "model.onnx"),
		);
	});

	test("misses until the file exists, and for anything else", async () => {
		expect(await hubDiskCache(HUB, DIR, () => false).match(ONNX)).toBeUndefined();
		const cache = hubDiskCache(HUB, DIR, () => true);
		expect(await cache.match(ONNX.replace(".onnx", ".json"))).toBeUndefined();
		expect(await cache.match(ONNX.replace(HUB, "https://huggingface.co/"))).toBeUndefined();
		expect(await cache.match(`${HUB}a/../../etc/x.onnx`)).toBeUndefined();
	});
});

test("default predicate rejects an LFS pointer in place of model.onnx", async () => {
	const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const dir = mkdtempSync(join(tmpdir(), "hubcache-"));
	const rel = ["onnx-community", "Kokoro-82M-v1.0-ONNX", "resolve", "main", "onnx"];
	mkdirSync(join(dir, ...rel), { recursive: true });
	const file = join(dir, ...rel, "model.onnx");
	writeFileSync(file, "version https://git-lfs.github.com/spec/v1\noid sha256:x\n");
	expect(await hubDiskCache(HUB, dir).match(ONNX)).toBeUndefined();
	writeFileSync(file, Buffer.alloc(60_000, 1));
	expect(await hubDiskCache(HUB, dir).match(ONNX)).toBe(file);
});
