import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
	buildDomPlainTextPre,
	canonicalRangeToDisplayOffsets,
	spanCanonicalRange,
} from "./domPlainTextPre";
import {
	buildPreToCanonicalMap,
	extractBodyHtml,
	htmlToPlainText,
} from "./htmlPlainText";
import { sanitizeEpubHtml } from "./sanitizeEpubHtml";
import { buildTtsChunks } from "../mainview/features/reader/tts/chunkText";

/**
 * Read-along highlights map TTS chunk offsets (built from the Bun regex
 * {@link htmlToPlainText}) onto the webview's real-DOM text nodes. If those two
 * parsers ever disagree about how many characters a tag contributes, every
 * highlight after that tag drifts — this is what made <hr>/<img> push the
 * highlight forward. These tests pin the invariant so it can't silently return.
 */

beforeAll(() => {
	const win = new Window();
	const g = globalThis as unknown as Record<string, unknown>;
	g.Node = win.Node;
	g.Text = win.Text;
	g.DOMParser = win.DOMParser;
});

/** Canonical text derived the way the webview does it: real DOM walk → map. */
function domCanonical(html: string): string {
	const doc = new DOMParser().parseFromString(
		`<body>${extractBodyHtml(html)}</body>`,
		"text/html",
	);
	const { pre } = buildDomPlainTextPre(doc.body as unknown as Node);
	return buildPreToCanonicalMap(pre).canonical;
}

/** The display text the highlight would cover for a chunk, via the DOM mapping. */
function highlightedDisplay(
	html: string,
	chunk: { start: number; end: number },
): string {
	const doc = new DOMParser().parseFromString(
		`<body>${extractBodyHtml(html)}</body>`,
		"text/html",
	);
	const { pre, spans } = buildDomPlainTextPre(doc.body as unknown as Node);
	const { map } = buildPreToCanonicalMap(pre);
	let out = "";
	for (const span of spans) {
		const { start: cs, end: ce } = spanCanonicalRange(map, span);
		if (chunk.end <= cs || chunk.start >= ce) continue;
		const { ls, le } = canonicalRangeToDisplayOffsets(
			map,
			span,
			Math.max(chunk.start, cs),
			Math.min(chunk.end, ce),
		);
		out += span.display.slice(ls, le);
	}
	return out;
}

const HR = "<hr/>";
const CASES: Record<string, string> = {
	"hr between paragraphs":
		"<p>The first sentence is here. The second one follows.</p>" +
		HR +
		"<p>A third paragraph begins now and continues onward.</p>",
	"hr after heading":
		"<h2>Chapter Two</h2>" + HR + "<p>It was a dark and stormy night indeed.</p>",
	"hr inside phrasing content":
		"<p>The first part of the text.<hr/>The second part continues right here.</p>",
	"hr at chapter start":
		HR + "<p>The opening line of the chapter sits here.</p>",
	"hr at chapter end":
		"<p>The closing line of the chapter sits here.</p>" + HR,
	"consecutive hr rules":
		"<p>Alpha sentence stands alone here.</p>" +
		HR +
		HR +
		"<p>Beta sentence stands alone here.</p>",
	"hr with attributes and whitespace":
		'<p>One sentence with words.</p>\n  <hr class="sep" id="x" />\n  ' +
		"<p>Another sentence with words.</p>",
	"hr beside images":
		'<p>Caption text describing things.</p><hr/><img src="a.png" alt="art"/>' +
		"<p>Following paragraph of text.</p>",
	"hr inside a list":
		"<ul><li>First list entry here.</li><hr/><li>Second list entry here.</li></ul>",
	"hr near inline markup":
		"<p>A line with <em>emphasis</em> in it.</p><hr/>" +
		"<p>A line with <strong>bold</strong> too.</p>",
};

describe("EPUB read-along alignment with <hr> and friends", () => {
	for (const [name, raw] of Object.entries(CASES)) {
		const html = sanitizeEpubHtml(raw);

		test(`${name}: DOM walk text == TTS text`, () => {
			expect(domCanonical(html)).toBe(htmlToPlainText(html));
		});

		test(`${name}: every chunk highlights exactly its spoken text`, () => {
			const chunks = buildTtsChunks(htmlToPlainText(html));
			expect(chunks.length).toBeGreaterThan(0);
			for (const chunk of chunks) {
				expect(highlightedDisplay(html, chunk)).toBe(chunk.text);
			}
		});
	}

	test("a stray <hr> contributes zero characters to TTS text", () => {
		const withHr = sanitizeEpubHtml("<p>before</p><hr/><p>after</p>");
		const withoutHr = sanitizeEpubHtml("<p>before</p><p>after</p>");
		expect(htmlToPlainText(withHr)).toBe(htmlToPlainText(withoutHr));
	});
});
