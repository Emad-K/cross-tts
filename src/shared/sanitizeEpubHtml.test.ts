import { describe, expect, test } from "bun:test";
import { sanitizeEpubHtml } from "./sanitizeEpubHtml";

describe("sanitizeEpubHtml (sanitize-html)", () => {
	test("strips script and event handlers", () => {
		const dirty =
			'<p onclick="alert(1)">Hi</p><script>alert(1)</script><iframe src="x"></iframe>';
		const clean = sanitizeEpubHtml(dirty);
		expect(clean).not.toContain("<script");
		expect(clean).not.toContain("onclick");
		expect(clean).not.toContain("iframe");
		expect(clean).toContain("Hi");
	});

	test("blocks javascript: URLs on links and images", () => {
		const dirty =
			'<a href="javascript:alert(1)">x</a><img src="javascript:alert(1)" alt="a">';
		const clean = sanitizeEpubHtml(dirty);
		expect(clean).not.toContain("javascript:");
	});

	test("removes unknown tags but keeps text", () => {
		const dirty = "<p>ok</p><evil>bad</evil>";
		const clean = sanitizeEpubHtml(dirty);
		expect(clean).toContain("ok");
		expect(clean).not.toContain("<evil");
		expect(clean).toContain("bad");
	});
});
