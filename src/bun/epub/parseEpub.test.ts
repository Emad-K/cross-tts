import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { buildManifestHrefLookup, readEpubManifest } from "./parseEpub";

async function writeEpub(path: string, title: string): Promise<void> {
	const zip = new JSZip();
	zip.file(
		"META-INF/container.xml",
		`<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`,
	);
	zip.file(
		"content.opf",
		`<?xml version="1.0"?><package><metadata><dc:title>${title}</dc:title></metadata>` +
			`<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>` +
			`<spine><itemref idref="c1"/></spine></package>`,
	);
	zip.file("c1.xhtml", "<html><body><p>Hello.</p></body></html>");
	writeFileSync(path, await zip.generateAsync({ type: "uint8array" }));
}

describe("EPUB cache", () => {
	test("a replaced file is re-parsed instead of served stale", async () => {
		const p = join(mkdtempSync(join(tmpdir(), "epub-")), "b.epub");
		await writeEpub(p, "First");
		expect((await readEpubManifest(p))?.title).toBe("First");
		await writeEpub(p, "Second edition");
		expect((await readEpubManifest(p))?.title).toBe("Second edition");
	});
});

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
