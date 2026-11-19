import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
	audioExportPath,
	hubRequestPath,
	isAllowedOrigin,
	isInsideRoot,
} from "./securityGuards";
import { MODEL_REVISION as rev } from "../shared/modelAssets";

describe("hubRequestPath", () => {
	const t = "abc123";
	const repo = "onnx-community/Kokoro-82M-v1.0-ONNX";
	test("maps allowed Kokoro files", () => {
		for (const f of ["config.json", "onnx/model.onnx", "voices/af_heart.bin"]) {
			expect(hubRequestPath(`/${t}/${repo}/resolve/${rev}/${f}`, t)).toBe(
				`/${repo}/resolve/${rev}/${f}`,
			);
		}
		expect(hubRequestPath(`/${t}/${repo}/resolve/${rev}/voices%2Faf.bin`, t)).toBe(
			`/${repo}/resolve/${rev}/voices/af.bin`,
		);
	});
	test("rejects wrong token, other repos, prefixes, traversal, other types", () => {
		expect(hubRequestPath(`/${repo}/resolve/${rev}/config.json`, t)).toBeNull();
		expect(hubRequestPath(`/nope/${repo}/resolve/${rev}/config.json`, t)).toBeNull();
		expect(hubRequestPath(`/${t}/gpt2/resolve/${rev}/config.json`, t)).toBeNull();
		expect(hubRequestPath(`/${t}/${repo}`, t)).toBeNull();
		expect(hubRequestPath(`/${t}/${repo}/resolve/${rev}/onnx`, t)).toBeNull();
		expect(hubRequestPath(`/${t}/${repo}/resolve/${rev}/../x.json`, t)).toBeNull();
		expect(hubRequestPath(`/${t}/${repo}/resolve/${rev}/%2e%2e/x.json`, t)).toBeNull();
		expect(hubRequestPath(`/${t}/${repo}/resolve/${rev}/x.html`, t)).toBeNull();
		expect(hubRequestPath(`/${t}/${repo}/resolve/${rev}/%zz.json`, t)).toBeNull();
		expect(hubRequestPath(`//${repo}/resolve/${rev}/config.json`, "")).toBeNull();
	});
	test("rejects unpinned revisions and ONNX files without a known sha256", () => {
		expect(hubRequestPath(`/${t}/${repo}/resolve/main/config.json`, t)).toBeNull();
		expect(hubRequestPath(`/${t}/${repo}/resolve/main/onnx/model.onnx`, t)).toBeNull();
		expect(hubRequestPath(`/${t}/${repo}/resolve/${rev}/onnx/model_q4.onnx`, t)).toBeNull();
	});
});

describe("isInsideRoot", () => {
	const roots = [resolve("/home/u/Audiobooks")];
	test("root itself and children", () => {
		expect(isInsideRoot("/home/u/Audiobooks", roots)).toBe(true);
		expect(isInsideRoot("/home/u/Audiobooks/Book/", roots)).toBe(true);
	});
	test("escapes and siblings", () => {
		expect(isInsideRoot("/home/u/Audiobooks/../.config", roots)).toBe(false);
		expect(isInsideRoot("/home/u/AudiobooksEvil", roots)).toBe(false);
		expect(isInsideRoot("/home/u", roots)).toBe(false);
		expect(isInsideRoot("", roots)).toBe(false);
		expect(isInsideRoot("/home/u/Audiobooks\0", roots)).toBe(false);
		expect(isInsideRoot("/home/u/Audiobooks", [])).toBe(false);
	});
});

describe("audioExportPath", () => {
	const root = resolve("/home/u/Audiobooks");
	test("accepts a plain audio file name in a root", () => {
		expect(audioExportPath(root, "01 - Intro.mp3", [root])).toBe(
			join(root, "01 - Intro.mp3"),
		);
		expect(audioExportPath(root, "Book.M4B", [root])).toBe(join(root, "Book.M4B"));
		expect(audioExportPath(root, "01 - Intro.mp3.part", [root])).toBe(
			join(root, "01 - Intro.mp3.part"),
		);
	});
	test("rejects traversal, separators, other types, bad input", () => {
		expect(audioExportPath(root, "../.bashrc.mp3", [root])).toBeNull();
		expect(audioExportPath(root, "a/b.mp3", [root])).toBeNull();
		expect(audioExportPath(root, "a\\b.mp3", [root])).toBeNull();
		expect(audioExportPath(root, "evil.desktop", [root])).toBeNull();
		expect(audioExportPath(root, "evil.part", [root])).toBeNull();
		expect(audioExportPath(root, "x.mp3.part.part", [root])).toBeNull();
		expect(audioExportPath(root, "..", [root])).toBeNull();
		expect(audioExportPath("/home/u", "x.mp3", [root])).toBeNull();
		expect(audioExportPath(root, 5, [root])).toBeNull();
		expect(audioExportPath(null, "x.mp3", [root])).toBeNull();
	});
});

describe("isAllowedOrigin", () => {
	const allowed = ["app://bundle", "http://localhost:5173"];
	test("accepts app and dev origins", () => {
		expect(isAllowedOrigin("app://bundle/index.html#x", allowed)).toBe(true);
		expect(isAllowedOrigin("http://localhost:5173/", allowed)).toBe(true);
	});
	test("rejects everything else", () => {
		expect(isAllowedOrigin("https://evil.example/", allowed)).toBe(false);
		expect(isAllowedOrigin("app://evil/index.html", allowed)).toBe(false);
		expect(isAllowedOrigin("http://localhost:5174/", allowed)).toBe(false);
		expect(isAllowedOrigin("file:///etc/passwd", allowed)).toBe(false);
		expect(isAllowedOrigin("not a url", allowed)).toBe(false);
	});
});
