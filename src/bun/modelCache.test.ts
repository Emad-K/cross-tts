import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MODEL_REPO, MODEL_REVISION } from "../shared/modelAssets";
import { adoptLegacyModelCache, downloadToFile } from "./modelCache";

const body = "model bytes";
const sha = createHash("sha256").update(body).digest("hex");
const server = Bun.serve({ port: 0, fetch: () => new Response(body) });
const url = `http://127.0.0.1:${server.port}/f.onnx`;
afterAll(() => server.stop(true));

describe("downloadToFile", () => {
	test("writes the file when the sha256 matches", async () => {
		const dest = join(mkdtempSync(join(tmpdir(), "mc-")), "a", "f.onnx");
		await downloadToFile(url, dest, sha);
		expect(readFileSync(dest, "utf8")).toBe(body);
		expect(readdirSync(dirname(dest))).toEqual(["f.onnx"]);
	});
	test("concurrent downloads of one file don't share a temp file", async () => {
		const dest = join(mkdtempSync(join(tmpdir(), "mc-")), "f.onnx");
		await Promise.all([downloadToFile(url, dest, sha), downloadToFile(url, dest, sha)]);
		expect(readFileSync(dest, "utf8")).toBe(body);
		expect(readdirSync(dirname(dest))).toEqual(["f.onnx"]);
	});
	test("discards the download on a sha256 mismatch", async () => {
		const dest = join(mkdtempSync(join(tmpdir(), "mc-")), "f.onnx");
		await expect(downloadToFile(url, dest, "0".repeat(64))).rejects.toThrow(
			/Checksum mismatch/,
		);
		expect(readdirSync(dirname(dest))).toEqual([]);
	});
});

describe("adoptLegacyModelCache", () => {
	test("moves resolve/main to the pinned revision once, minus unverified weights", () => {
		const cache = mkdtempSync(join(tmpdir(), "mc-"));
		const base = join(cache, ...MODEL_REPO.split("/"), "resolve");
		mkdirSync(join(base, "main", "onnx"), { recursive: true });
		writeFileSync(join(base, "main", "onnx", "model.onnx"), "x");
		writeFileSync(join(base, "main", "config.json"), "{}");
		adoptLegacyModelCache(cache);
		expect(existsSync(join(base, "main"))).toBe(false);
		// Hash mismatch: dropped, re-downloaded (verified) on demand.
		expect(existsSync(join(base, MODEL_REVISION, "onnx", "model.onnx"))).toBe(false);
		expect(readFileSync(join(base, MODEL_REVISION, "config.json"), "utf8")).toBe("{}");
		// A later legacy folder never overwrites the pinned one.
		mkdirSync(join(base, "main"));
		adoptLegacyModelCache(cache);
		expect(existsSync(join(base, "main"))).toBe(true);
	});
});
