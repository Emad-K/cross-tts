import { describe, expect, test } from "bun:test";
import { kokoroNormalizeText } from "./kokoroPhonemize";

describe("kokoroNormalizeText", () => {
	test("collapses every run of multiple spaces, not just the first", () => {
		// Upstream kokoro-js has the same missing-`g` bug; extra spaces survive
		// normalization, become extra tokens, and shift the style-vector row.
		expect(kokoroNormalizeText("a  b  c   d")).toBe("a b c d");
	});
});
