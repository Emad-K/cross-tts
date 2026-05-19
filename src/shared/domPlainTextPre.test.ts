import { describe, expect, test } from "bun:test";
import { buildTtsChunks } from "../mainview/features/reader/tts/chunkText";
import {
	canonicalRangeToDisplayOffsets,
	spanCanonicalRange,
	type DomTextSpan,
} from "./domPlainTextPre";
import { buildPreToCanonicalMap, htmlToPlainText } from "./htmlPlainText";

/** Pre buffer built the same way as {@link buildDomPlainTextPre} for h1 + hr + p. */
function chapterPre(title: string, paragraph: string): string {
	return ` ${title}\n\n ${paragraph}\n\n`;
}

function paragraphSpan(pre: string, paragraph: string): DomTextSpan {
	const preStart = pre.indexOf(paragraph);
	expect(preStart).toBeGreaterThanOrEqual(0);
	return {
		node: null as unknown as Text,
		display: paragraph,
		preStart,
		preEnd: preStart + paragraph.length,
	};
}

describe("dom plain text pre (offset map)", () => {
	test("pre buffer matches htmlToPlainText for chapter with hr", () => {
		const title = "Chapter 1: Spirit Awakening";
		const paragraph =
			"Martial arts. It decides your fate as well as your life and death. The weak is humiliated while the strong looks down on the world.";
		const html = `<body><h1>${title}</h1><hr/><p>${paragraph}</p></body>`;
		const pre = chapterPre(title, paragraph);
		const { canonical } = buildPreToCanonicalMap(pre);
		expect(canonical).toBe(htmlToPlainText(html));
	});

	test("chunk highlight lands on correct sentence after hr", () => {
		const paragraph =
			"Martial arts. It decides your fate as well as your life and death. The weak is humiliated while the strong looks down on the world.";
		const pre = chapterPre("Title", paragraph);
		const { canonical, map } = buildPreToCanonicalMap(pre);
		const span = paragraphSpan(pre, paragraph);

		const chunks = buildTtsChunks(canonical);
		const weakChunk = chunks.find((c) => c.text.startsWith("The weak"));
		expect(weakChunk).toBeDefined();

		const { start: canonStart, end: canonEnd } = spanCanonicalRange(
			map,
			span,
		);
		const { ls, le } = canonicalRangeToDisplayOffsets(
			map,
			span,
			weakChunk!.start,
			weakChunk!.end,
		);
		expect(span.display.slice(ls, le)).toBe(weakChunk!.text);
		expect(canonStart).toBeLessThanOrEqual(weakChunk!.start);
		expect(canonEnd).toBeGreaterThanOrEqual(weakChunk!.end);
	});
});
