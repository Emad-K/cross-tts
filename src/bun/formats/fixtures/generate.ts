/**
 * Regenerates the fixtures in this folder: `bun src/bun/formats/fixtures/generate.ts`.
 * They are committed, so tests don't depend on this script; it exists so the
 * binary ones (.pdf, .docx) can be reviewed and rebuilt from readable source.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";

const here = import.meta.dirname;

/** A minimal PDF: one content stream per page, optional top-level outline. */
function buildPdf(pages: string[], outline: { title: string; page: number }[] = []): Uint8Array {
	const objects: string[] = [];
	const add = (body: string) => objects.push(body);
	const pageId = (i: number) => 4 + i * 2;
	const outlineRoot = 4 + pages.length * 2;

	add(
		`<< /Type /Catalog /Pages 2 0 R${outline.length ? ` /Outlines ${outlineRoot} 0 R /PageMode /UseOutlines` : ""} >>`,
	);
	add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
	add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
	for (const [i, content] of pages.entries()) {
		add(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId(i) + 1} 0 R >>`,
		);
		add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
	}
	if (outline.length) {
		const item = (i: number) => outlineRoot + 1 + i;
		add(`<< /Type /Outlines /First ${item(0)} 0 R /Last ${item(outline.length - 1)} 0 R /Count ${outline.length} >>`);
		for (const [i, entry] of outline.entries()) {
			add(
				`<< /Title (${entry.title}) /Parent ${outlineRoot} 0 R /Dest [${pageId(entry.page)} 0 R /Fit]` +
					(i > 0 ? ` /Prev ${item(i - 1)} 0 R` : "") +
					(i < outline.length - 1 ? ` /Next ${item(i + 1)} 0 R` : "") +
					" >>",
			);
		}
	}

	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(pdf.length);
		pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(pdf); // ASCII only, so bytes == chars
}

/** Lines of 12pt text from the top margin; an empty string leaves a blank line. */
function textPage(lines: string[], x = 72): string {
	let y = 720;
	const ops = ["BT", "/F1 12 Tf"];
	for (const line of lines) {
		if (line) ops.push(`1 0 0 1 ${x} ${y} Tm (${line}) Tj`);
		y -= 14;
	}
	return [...ops, "ET"].join("\n");
}

const outlinePdf = buildPdf(
	[
		textPage(["A Small Book", "", "", "Front words before the first chapter."]),
		textPage([
			"Chapter One",
			"",
			"",
			"The first paragraph runs over two lines and ends with a hyphen-",
			"ated word that must be joined again.",
			"",
			"",
			"A second paragraph follows after a gap and its sentence is cut by the page",
		]),
		textPage(["break, then carries on at the top of the next page."]),
		textPage(["Chapter Two", "", "", "Closing words of the second chapter."]),
	],
	[
		{ title: "Chapter One", page: 1 },
		{ title: "Chapter Two", page: 3 },
	],
);

// Two columns stored column by column: the left column's lines, then the right.
const columnsPdf = buildPdf([
	`${textPage(["Left one", "left two", "left three", "left four."])}\n${textPage(
		["Right one", "right two", "right three", "right four."],
		320,
	)}`,
]);

const plainPdf = buildPdf(
	Array.from({ length: 12 }, (_, i) => textPage([`This is the text of page ${i + 1}.`])),
);

// A page with a drawn rectangle and no text: what a scan looks like to us.
const scannedPdf = buildPdf(["0.5 g\n72 72 468 648 re\nf"]);

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Words before any heading.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>First Part</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">The first part has </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:t xml:space="preserve"> text.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>A Section</w:t></w:r></w:p>
<w:p><w:r><w:t>Section text &lt;script&gt;alert(1)&lt;/script&gt; stays text.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Second Part</w:t></w:r></w:p>
<w:p><w:r><w:t>The second part ends the document.</w:t></w:r></w:p>
</w:body>
</w:document>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
</w:styles>`;

async function buildDocx(): Promise<Uint8Array> {
	const zip = new JSZip();
	// Fixed date so regenerating doesn't change the bytes.
	const date = new Date("2026-01-01T00:00:00Z");
	const put = (name: string, data: string) => zip.file(name, data, { date });
	put(
		"[Content_Types].xml",
		`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
	);
	put(
		"_rels/.rels",
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
	);
	put(
		"word/_rels/document.xml.rels",
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
	);
	put("word/document.xml", DOCUMENT_XML);
	put("word/styles.xml", STYLES_XML);
	return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>An HTML Story</title>
<style>p { color: red }</style>
<script>window.stolen = document.cookie;</script>
</head>
<body onload="alert(1)">
<p>Opening words before any heading.</p>
<div class="wrap">
<h1>Part One</h1>
<p>First part text with a <a href="https://example.com/track">link</a> and an image <img src="https://example.com/pixel.png" alt="pixel">.</p>
<script>fetch("https://example.com/steal")</script>
<h2 onclick="alert(2)">A Section</h2>
<p>Section text &amp; more.</p>
</div>
<h1>Part Two</h1>
<p>Second part text.</p>
<iframe src="https://example.com/frame"></iframe>
</body>
</html>
`;

const MARKDOWN = `---
title: ignored front matter
---

Intro line before any heading, with **bold**, _emphasis_ and \`code\`.

# First Chapter

A paragraph with a [link](https://example.com) and an image ![alt text](pic.png)
that wraps onto a second line. Keep snake_case and 2 * 3 as they are.

- one item
- another item
  wrapped onto the next line

## A Section

1. first
2. second

\`\`\`js
const x = "<b>not html</b>";
\`\`\`

<script>alert(1)</script>

Second Chapter
==============

> A quoted closing line.
`;

writeFileSync(join(here, "outline.pdf"), outlinePdf);
writeFileSync(join(here, "columns.pdf"), columnsPdf);
writeFileSync(join(here, "plain.pdf"), plainPdf);
writeFileSync(join(here, "scanned.pdf"), scannedPdf);
writeFileSync(join(here, "sample.docx"), await buildDocx());
writeFileSync(join(here, "sample.html"), HTML);
writeFileSync(join(here, "sample.md"), MARKDOWN);
console.log("fixtures written to", here);
