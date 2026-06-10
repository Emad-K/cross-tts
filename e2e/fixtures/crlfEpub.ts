import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";

/**
 * Chapter XHTML with CRLF line endings *inside* text nodes. This is the exact
 * input class that broke read-along offsets in v1.7.6: happy-dom unit tests
 * keep `\r` in text nodes, but real Chromium normalizes CRLF to LF at parse
 * time, so any plain-text pipeline that doesn't normalize identically drifts.
 *
 * Joined with \r\n so every newline in the file — including mid-paragraph ones
 * — is a CRLF.
 */
export const CHAPTER_XHTML_LINES = [
	'<?xml version="1.0" encoding="utf-8"?>',
	'<html xmlns="http://www.w3.org/1999/xhtml">',
	"<head><title>Chapter One</title></head>",
	"<body>",
	"<h1>Chapter One</h1>",
	"<p>First sentence rendered from a chapter with Windows line endings.",
	"This continuation lives on a CRLF-separated line inside the same paragraph.</p>",
	"<p>Second paragraph starts here. It contains a second sentence to make",
	"more than one read-along chunk appear in the viewer.</p>",
	"<p>Closing words confirm the chapter really rendered to the end.</p>",
	"</body>",
	"</html>",
];

export const CHAPTER_XHTML = CHAPTER_XHTML_LINES.join("\r\n");

/** Manifest id of the single chapter (chapter ids are EPUB manifest ids). */
export const CHAPTER_ID = "chap1";

export const BOOK_TITLE = "CRLF Smoke Book";

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
	</rootfiles>
</container>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:identifier id="uid">urn:uuid:e2e-crlf-fixture</dc:identifier>
		<dc:title>${BOOK_TITLE}</dc:title>
		<dc:language>en</dc:language>
	</metadata>
	<manifest>
		<item id="${CHAPTER_ID}" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
	</manifest>
	<spine>
		<itemref idref="${CHAPTER_ID}"/>
	</spine>
</package>`;

/**
 * Build the minimal CRLF EPUB into `dir` and return its absolute path.
 * No nav/NCX on purpose: the app falls back to spine-derived chapters, which
 * keeps the fixture tiny while still exercising the real EPUB pipeline.
 */
export async function buildCrlfEpub(dir: string): Promise<string> {
	const zip = new JSZip();
	// Per spec the mimetype entry must be first and uncompressed.
	zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
	zip.file("META-INF/container.xml", CONTAINER_XML);
	zip.file("OEBPS/content.opf", CONTENT_OPF);
	zip.file("OEBPS/chapter1.xhtml", CHAPTER_XHTML);
	const bytes = await zip.generateAsync({ type: "nodebuffer" });
	mkdirSync(dir, { recursive: true });
	const epubPath = join(dir, "crlf-fixture.epub");
	writeFileSync(epubPath, bytes);
	return epubPath;
}
