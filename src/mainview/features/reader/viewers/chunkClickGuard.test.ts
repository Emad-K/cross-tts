import { describe, expect, test } from "bun:test";
import { isTextSelectionClick, type SelectionLike } from "./chunkClickGuard";

function sel(isCollapsed: boolean, text: string): SelectionLike {
	return { isCollapsed, toString: () => text };
}

describe("isTextSelectionClick", () => {
	test("null selection is a plain click", () => {
		expect(isTextSelectionClick(null)).toBe(false);
	});

	test("collapsed selection (caret) is a plain click", () => {
		expect(isTextSelectionClick(sel(true, ""))).toBe(false);
	});

	test("collapsed selection with stale text is still a plain click", () => {
		expect(isTextSelectionClick(sel(true, "left over"))).toBe(false);
	});

	test("non-collapsed selection with text is a selection drag", () => {
		expect(isTextSelectionClick(sel(false, "some words"))).toBe(true);
	});

	test("whitespace-only selection still counts as a drag", () => {
		expect(isTextSelectionClick(sel(false, " "))).toBe(true);
	});

	test("non-collapsed but empty selection is treated as a click", () => {
		expect(isTextSelectionClick(sel(false, ""))).toBe(false);
	});
});
