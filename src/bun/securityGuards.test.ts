import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
	audioExportPath,
	hubFileSha256,
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
	test("serves each engine's own repos, revisions and extensions", () => {
		const repos = [
			{ repo: "org/a", revision: "r1", extensions: ["json"], unhashedExtensions: ["json"], sha256: {} },
			{ repo: "org/b", revision: "r2", extensions: ["onnx"], unhashedExtensions: [], sha256: { "m.onnx": "h" } },
		];
		expect(hubRequestPath(`/${t}/org/a/resolve/r1/x.json`, t, repos)).toBe("/org/a/resolve/r1/x.json");
		expect(hubRequestPath(`/${t}/org/a/resolve/r2/x.json`, t, repos)).toBeNull();
		expect(hubRequestPath(`/${t}/org/a/resolve/r1/m.onnx`, t, repos)).toBeNull();
		expect(hubRequestPath(`/${t}/org/b/resolve/r2/m.onnx`, t, repos)).toBe("/org/b/resolve/r2/m.onnx");
		expect(hubFileSha256("/org/b/resolve/r2/m.onnx", repos)).toBe("h");
		expect(hubFileSha256(`/${repo}/resolve/${rev}/onnx/model.onnx`)).toMatch(/^[0-9a-f]{64}$/);
		expect(hubFileSha256(`/${repo}/resolve/${rev}/config.json`)).toBeUndefined();
	});
	test("serves hash-pinned files whatever their extension, and only those", () => {
		const repos = [
			{ repo: "org/d", revision: "r", extensions: ["onnx"], unhashedExtensions: [], sha256: { LICENSE: "h" } },
		];
		expect(hubRequestPath(`/${t}/org/d/resolve/r/LICENSE`, t, repos)).toBe("/org/d/resolve/r/LICENSE");
		expect(hubFileSha256("/org/d/resolve/r/LICENSE", repos)).toBe("h");
		expect(hubRequestPath(`/${t}/org/d/resolve/main/LICENSE`, t, repos)).toBeNull();
		expect(hubRequestPath(`/${t}/org/d/resolve/r/README`, t, repos)).toBeNull();
		expect(hubRequestPath(`/${t}/org/d/resolve/r/constructor`, t, repos)).toBeNull();
		const st = "supertone-oss-archive/supertonic-3";
		const strev = "aafc6e32416a594460b32413efc49d7fe4ce6d46";
		for (const f of ["LICENSE", "onnx/vocoder.onnx", "onnx/tts.json", "voice_styles/F1.json"]) {
			expect(hubFileSha256(`/${st}/resolve/${strev}/${f}`)).toMatch(/^[0-9a-f]{64}$/);
		}
		expect(hubRequestPath(`/${t}/${st}/resolve/${strev}/voice_styles/X9.json`, t)).toBeNull();
	});
	test("refuses any weight file without a pinned sha256, whatever its format", () => {
		const repos = [
			{
				repo: "org/c",
				revision: "r",
				extensions: ["json", "gguf", "safetensors"],
				unhashedExtensions: ["json"],
				sha256: { "ok.gguf": "h" },
			},
		];
		expect(hubRequestPath(`/${t}/org/c/resolve/r/config.json`, t, repos)).toBe("/org/c/resolve/r/config.json");
		expect(hubRequestPath(`/${t}/org/c/resolve/r/ok.gguf`, t, repos)).toBe("/org/c/resolve/r/ok.gguf");
		expect(hubRequestPath(`/${t}/org/c/resolve/r/other.gguf`, t, repos)).toBeNull();
		expect(hubRequestPath(`/${t}/org/c/resolve/r/model.safetensors`, t, repos)).toBeNull();
	});
	test("a repo listed by two engines is judged on all its entries, in any order", () => {
		const a = { repo: "org/v", revision: "r", extensions: ["bin"], unhashedExtensions: ["bin"], sha256: {} };
		const b = {
			repo: "org/v",
			revision: "r",
			extensions: ["bin", "onnx"],
			unhashedExtensions: [],
			sha256: { "v.bin": "hv", "m.onnx": "hm" },
		};
		for (const repos of [[a, b], [b, a]]) {
			expect(hubRequestPath(`/${t}/org/v/resolve/r/m.onnx`, t, repos)).toBe("/org/v/resolve/r/m.onnx");
			expect(hubFileSha256("/org/v/resolve/r/v.bin", repos)).toBe("hv");
			expect(hubFileSha256("/org/v/resolve/r/m.onnx", repos)).toBe("hm");
			expect(hubRequestPath(`/${t}/org/v/resolve/r/x.bin`, t, repos)).toBeNull();
		}
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
