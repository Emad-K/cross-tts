import { describe, expect, test } from "bun:test";
import { buildPreToCanonicalMap, htmlToPlainText } from "./htmlPlainText";

describe("htmlToPlainText", () => {
	test("inline tags become spaces like strip phase", () => {
		const html = "<p>Hello <em>world</em>.</p>";
		expect(htmlToPlainText(html)).toBe("Hello world .");
	});

	test("ignores head when body is present", () => {
		const html =
			"<html><head><title>Title</title></head><body><p>Body</p></body></html>";
		expect(htmlToPlainText(html)).toBe("Body");
	});

	test("hr and img contribute no characters to plain text", () => {
		const html =
			'<h1>Chapter 1</h1><hr/><img src="x.png" alt="pic"/><p>Martial arts.</p>';
		expect(htmlToPlainText(html)).toBe("Chapter 1\n\n Martial arts.");
	});

	test("CRLF source produces no carriage returns (matches webview DOM)", () => {
		// Chromium normalizes CRLF/CR → LF when parsing, so the webview DOM text
		// has no \r. The regex path must match or every offset after a CRLF drifts
		// the read-along highlight (the bug behind mid-word highlights on CRLF
		// EPUBs). happy-dom keeps \r, so assert the invariant directly here.
		const html =
			"<body>\r\n  <h2>Chapter 1: Spirit Awakening</h2>\r\n\r\n  <hr/>\r\n\r\n  <p>Martial arts. The weak is humiliated.</p>\r\n</body>";
		const out = htmlToPlainText(html);
		expect(out.includes("\r")).toBe(false);
		expect(out).toBe(
			"Chapter 1: Spirit Awakening\n\n Martial arts. The weak is humiliated.",
		);
	});
});

describe("buildPreToCanonicalMap", () => {
	test("does not drift after tag-space boundaries", () => {
		const pre = " Hello " + " " + " world";
		const { canonical, map } = buildPreToCanonicalMap(pre);
		expect(canonical).toBe("Hello world");
		expect(map[0]).toBe(0);
		expect(map[8]).toBe(6);
		expect(map[pre.length]).toBe(canonical.length);
	});

	test("many tag boundaries stay aligned", () => {
		let pre = "";
		const words = ["One", "two", "three", "four", "five"];
		for (const w of words) {
			pre += " ";
			pre += w;
			pre += " ";
		}
		const { canonical, map } = buildPreToCanonicalMap(pre);
		expect(canonical).toBe(words.join(" "));
		let pos = 0;
		for (const w of words) {
			pos += 1;
			expect(map[pos]).toBe(canonical.indexOf(w));
			pos += w.length;
			expect(map[pos]).toBe(canonical.indexOf(w) + w.length);
			pos += 1;
		}
	});
});
