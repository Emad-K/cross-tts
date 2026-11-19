import { describe, expect, test } from "bun:test";
import {
	documentKind,
	isSupportedDocumentName,
	partitionByDocumentSupport,
} from "./droppedFiles";

describe("isSupportedDocumentName", () => {
	test("accepts every supported extension, case-insensitive", () => {
		for (const name of ["a.pdf", "a.docx", "a.md", "a.markdown", "a.html", "a.HTM"]) {
			expect(isSupportedDocumentName(name)).toBe(true);
		}
		expect(documentKind("a.HTM")).toBe("html");
		expect(documentKind("a.markdown")).toBe("md");
		expect(isSupportedDocumentName("book.epub")).toBe(true);
		expect(isSupportedDocumentName("notes.txt")).toBe(true);
		expect(isSupportedDocumentName("BOOK.EPUB")).toBe(true);
		expect(isSupportedDocumentName("Notes.TXT")).toBe(true);
	});

	test("rejects other extensions and extension-less names", () => {
		expect(isSupportedDocumentName("book.doc")).toBe(false);
		expect(isSupportedDocumentName("book.mobi")).toBe(false);
		expect(isSupportedDocumentName("epub")).toBe(false);
		expect(isSupportedDocumentName("")).toBe(false);
		expect(isSupportedDocumentName("book.epub.zip")).toBe(false);
	});
});

describe("partitionByDocumentSupport", () => {
	test("splits supported and rejected files, preserving order", () => {
		const files = [
			{ name: "a.epub" },
			{ name: "b.mobi" },
			{ name: "c.txt" },
			{ name: "d.png" },
		];
		const { supported, rejected } = partitionByDocumentSupport(files);
		expect(supported.map((f) => f.name)).toEqual(["a.epub", "c.txt"]);
		expect(rejected.map((f) => f.name)).toEqual(["b.mobi", "d.png"]);
	});

	test("handles empty input", () => {
		const { supported, rejected } = partitionByDocumentSupport([]);
		expect(supported).toEqual([]);
		expect(rejected).toEqual([]);
	});
});
