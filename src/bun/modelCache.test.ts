import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
		expect(existsSync(`${dest}.download`)).toBe(false);
	});
	test("discards the download on a sha256 mismatch", async () => {
		const dest = join(mkdtempSync(join(tmpdir(), "mc-")), "f.onnx");
		await expect(downloadToFile(url, dest, "0".repeat(64))).rejects.toThrow(
			/Checksum mismatch/,
		);
		expect(existsSync(dest)).toBe(false);
		expect(existsSync(`${dest}.download`)).toBe(false);
	});
});

describe("adoptLegacyModelCache", () => {
	test("moves resolve/main to the pinned revision once", () => {
		const cache = mkdtempSync(join(tmpdir(), "mc-"));
		const base = join(cache, ...MODEL_REPO.split("/"), "resolve");
		mkdirSync(join(base, "main", "onnx"), { recursive: true });
		writeFileSync(join(base, "main", "onnx", "model.onnx"), "x");
		adoptLegacyModelCache(cache);
		expect(existsSync(join(base, "main"))).toBe(false);
		expect(readFileSync(join(base, MODEL_REVISION, "onnx", "model.onnx"), "utf8")).toBe("x");
		// A later legacy folder never overwrites the pinned one.
		mkdirSync(join(base, "main"));
		adoptLegacyModelCache(cache);
		expect(existsSync(join(base, "main"))).toBe(true);
	});
});
