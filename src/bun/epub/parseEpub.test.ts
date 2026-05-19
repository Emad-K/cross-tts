import { describe, expect, test } from "bun:test";
import { buildManifestHrefLookup } from "./parseEpub";

describe("buildManifestHrefLookup", () => {
	test("maps resolved hrefs to manifest ids", () => {
		const manifest = new Map([
			[
				"ch1",
				{
					id: "ch1",
					href: "text/chapter1.xhtml",
					mediaType: "application/xhtml+xml",
				},
			],
			[
				"ch2",
				{
					id: "ch2",
					href: "text/chapter2.xhtml",
					mediaType: "application/xhtml+xml",
				},
			],
		]);
		const lookup = buildManifestHrefLookup(manifest, "OEBPS");
		expect(lookup.get("OEBPS/text/chapter1.xhtml")).toBe("ch1");
		expect(lookup.get("OEBPS/text/chapter2.xhtml")).toBe("ch2");
		expect(lookup.size).toBe(2);
	});
});
