import { expect, test } from "bun:test";
import { pastedFileBase, pastedTitle } from "./pastedText";

test("pastedTitle is the first non-empty line, shortened", () => {
	expect(pastedTitle("\n\n  Hello   world \nsecond line")).toBe("Hello world");
	expect(pastedTitle("x".repeat(100))).toBe(`${"x".repeat(59)}…`);
	expect(pastedTitle("  \n ")).toBe("Pasted text");
});

test("pastedFileBase can't leave its folder or break a file system", () => {
	expect(pastedFileBase("../../etc/passwd")).toBe("etc passwd");
	expect(pastedFileBase('a<b>:"c"|d?*\\e/f\u0000g')).toBe("a b c d e f g");
	expect(pastedFileBase("...hidden. ")).toBe("hidden");
	expect(pastedFileBase("\n\t")).toBe("Pasted text");
	expect(pastedFileBase("y".repeat(200))).toHaveLength(60);
});
