import { describe, expect, test } from "bun:test";
import {
	preprocessSupertonicText,
	splitForSupertonic,
	supertonicTextIds,
} from "./supertonicModel";

describe("preprocessSupertonicText", () => {
	test("wraps in language tags and ends with punctuation", () => {
		expect(preprocessSupertonicText("Hello  world", "en")).toBe("<en>Hello world.</en>");
		expect(preprocessSupertonicText("Hallo — Welt!", "de")).toBe("<de>Hallo - Welt!</de>");
	});

	test("expands English-only expressions for English alone", () => {
		expect(preprocessSupertonicText("mail me@home, e.g., now", "en")).toBe(
			"<en>mail me at home, for example, now.</en>",
		);
		expect(preprocessSupertonicText("schreib an a@b, e.g., jetzt", "de")).toBe(
			"<de>schreib an a@b, e.g., jetzt.</de>",
		);
	});

	test("tidies spacing before punctuation and repeated quotes", () => {
		expect(preprocessSupertonicText('Oui , ""non"" !', "fr")).toBe('<fr>Oui, "non"!</fr>');
	});

	test("keeps CJK sentence endings", () => {
		expect(preprocessSupertonicText("こんにちは。", "ja")).toBe("<ja>こんにちは。</ja>");
	});
});

describe("supertonicTextIds", () => {
	test("maps code points and drops unknown characters", () => {
		const indexer = new Array(128).fill(-1);
		indexer["a".codePointAt(0)!] = 5;
		indexer["b".codePointAt(0)!] = 6;
		expect(supertonicTextIds("a?b😀", indexer)).toEqual([5, 6]);
	});
});

describe("splitForSupertonic", () => {
	test("keeps short text whole", () => {
		expect(splitForSupertonic("One. Two.", "en", 300)).toEqual(["One. Two."]);
	});

	test("packs sentences up to the limit", () => {
		const text = "First sentence here. Second one here. Third one here.";
		const pieces = splitForSupertonic(text, "en", 40);
		expect(pieces).toEqual(["First sentence here. Second one here.", "Third one here."]);
		for (const p of pieces) expect(p.length).toBeLessThanOrEqual(40);
	});

	test("splits an overlong sentence on words, and text without spaces", () => {
		const long = "word ".repeat(30).trim() + ".";
		for (const p of splitForSupertonic(long, "en", 50)) expect(p.length).toBeLessThanOrEqual(50);
		const ja = "あ".repeat(250);
		const pieces = splitForSupertonic(ja, "ja", 120);
		expect(pieces.join("")).toBe(ja);
		for (const p of pieces) expect(p.length).toBeLessThanOrEqual(120);
	});

	test("drops pieces with nothing to say", () => {
		expect(splitForSupertonic(" ... ", "en", 300)).toEqual([]);
	});
});
