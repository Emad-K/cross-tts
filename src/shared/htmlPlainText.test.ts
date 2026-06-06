import { describe, expect, test } from "bun:test";
import {
	buildPreToCanonicalMap,
	finalizePlainTextInner,
	htmlToPlainText,
} from "./htmlPlainText";

/** Naive O(n²) reference: re-finalize every prefix. The fast path must match. */
function referenceMap(pre: string): { canonical: string; map: number[] } {
	const innerFull = finalizePlainTextInner(pre);
	const leadingSkip = innerFull.length - innerFull.trimStart().length;
	const canonical = innerFull.trim();
	const canonicalLength = canonical.length;
	const map = new Array<number>(pre.length + 1);
	for (let i = 0; i <= pre.length; i++) {
		if (i >= pre.length) {
			map[i] = canonicalLength;
		} else {
			const inner = finalizePlainTextInner(pre.slice(0, i));
			map[i] = Math.min(
				canonicalLength,
				Math.max(0, inner.length - leadingSkip),
			);
		}
	}
	return { canonical, map };
}

/** Deterministic LCG so the fuzz cases are reproducible. */
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

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

describe("buildPreToCanonicalMap fast path == naive reference", () => {
	const fixed = [
		"",
		" ",
		"x",
		"a  b",
		"  Hello  \n\n  World  ",
		"a\r\nb\r\n\r\nc",
		"word \n   \n\n\n next",
		"\t\t tabs \t and   spaces \t\t",
		"trailing spaces   ",
		"\n\n\nleading newlines",
		"Chapter 1: Spirit Awakening\n\n \r\n\r\n Martial arts.\r\n",
		"mixed\r \t\n\r\n  end",
	];
	for (const pre of fixed) {
		test(`fixed: ${JSON.stringify(pre).slice(0, 40)}`, () => {
			const a = buildPreToCanonicalMap(pre);
			const b = referenceMap(pre);
			expect(a.canonical).toBe(b.canonical);
			expect(a.map).toEqual(b.map);
		});
	}

	test("fuzz: 400 random whitespace-heavy strings match the reference", () => {
		const rnd = lcg(0xc0ffee);
		const alphabet = ["a", "b", " ", " ", "\t", "\n", "\n", "\r"];
		for (let n = 0; n < 400; n++) {
			const len = Math.floor(rnd() * 40);
			let s = "";
			for (let i = 0; i < len; i++) {
				s += alphabet[Math.floor(rnd() * alphabet.length)];
			}
			const a = buildPreToCanonicalMap(s);
			const b = referenceMap(s);
			expect(a.canonical).toBe(b.canonical);
			expect(a.map).toEqual(b.map);
		}
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
