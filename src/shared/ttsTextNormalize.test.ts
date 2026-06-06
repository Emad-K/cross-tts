import { describe, expect, test } from "bun:test";
import { normalizeTtsSynthesisText, splitNumberUnit } from "./ttsTextNormalize";

describe("splitNumberUnit", () => {
	test("separates a number glued to a unit word", () => {
		expect(splitNumberUnit("This punch should have over 6000jin strength.")).toBe(
			"This punch should have over 6000 jin strength.",
		);
		expect(splitNumberUnit("100km away")).toBe("100 km away");
	});

	test("preserves ordinals", () => {
		expect(splitNumberUnit("the 5th layer")).toBe("the 5th layer");
		expect(splitNumberUnit("21st century, 2nd place, 3rd time")).toBe(
			"21st century, 2nd place, 3rd time",
		);
	});

	test("leaves single trailing letters alone", () => {
		expect(splitNumberUnit("a 3D model")).toBe("a 3D model");
		expect(splitNumberUnit("h264 codec")).toBe("h264 codec");
	});

	test("does not touch plain numbers or words", () => {
		expect(splitNumberUnit("He had 6000 of them.")).toBe("He had 6000 of them.");
		expect(splitNumberUnit("no digits here")).toBe("no digits here");
	});

	test("normalizeTtsSynthesisText composes the pass", () => {
		expect(normalizeTtsSynthesisText("reached 6000jin")).toBe("reached 6000 jin");
	});
});
