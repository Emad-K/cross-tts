import type { ReaderChapter } from "../types";

const TITLE_MAX = 56;

function titleFromBlock(block: string, index: number): string {
	const firstLine = block.split("\n").find((l) => l.trim().length > 0)?.trim();
	if (!firstLine) return `Section ${index + 1}`;
	const t = firstLine.replace(/\s+/g, " ");
	if (t.length <= TITLE_MAX) return t;
	return `${t.slice(0, TITLE_MAX - 1)}…`;
}

/**
 * Build a simple TOC from blank-line paragraph breaks until EPUB supplies real chapters.
 */
export function deriveTxtChapters(text: string): ReaderChapter[] {
	const normalized = text.replace(/\r\n/g, "\n");
	const chapters: ReaderChapter[] = [];
	let from = 0;
	const rx = /\n\n+/g;
	let m: RegExpExecArray | null;
	let index = 0;
	while ((m = rx.exec(normalized))) {
		const block = normalized.slice(from, m.index);
		if (block.trim().length > 0) {
			chapters.push({
				id: `txt-${index}`,
				title: titleFromBlock(block, index),
				level: 0,
			});
			index += 1;
		}
		from = m.index + m[0].length;
	}
	const tail = normalized.slice(from);
	if (tail.trim().length > 0) {
		chapters.push({
			id: `txt-${index}`,
			title: titleFromBlock(tail, index),
			level: 0,
		});
	}
	return chapters;
}
