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
