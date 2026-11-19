import { escapeHtml } from "./escapeHtml";

/**
 * Markdown → simple HTML for reading aloud: headings, paragraphs, lists and
 * code blocks. Emphasis, link and image markers are dropped (link text stays,
 * images go), and raw HTML tags are removed.
 *
 * ponytail: not CommonMark. Nested lists are flattened, tables are read as
 * plain rows and block quotes as paragraphs. Swap in a real parser (marked)
 * if people need the page to look like the rendered Markdown.
 *
 * Input is an untrusted file of up to 20 MB, so every pattern here is written
 * to stay linear: bounded repeats and character classes that stop at the next
 * opener, never a lazy scan to the end of the text.
 */
export function markdownToHtml(markdown: string): string {
	const lines = stripComments(
		markdown
			.replace(/\r\n?/g, "\n")
			.replace(/^\uFEFF/, "")
			.replace(/^---\n[\s\S]*?\n---\n/, ""), // front matter
	).split("\n");

	const out: string[] = [];
	let para: string[] = [];
	let list: "ul" | "ol" | null = null;
	let code: string[] | null = null;

	const flush = () => {
		if (para.length > 0) out.push(`<p>${inline(para.join(" "))}</p>`);
		para = [];
		if (list) out.push(`</${list}>`);
		list = null;
	};

	for (const rawLine of lines) {
		if (code) {
			if (/^\s*(```|~~~)/.test(rawLine)) {
				out.push(`<pre>${escapeHtml(code.join("\n"))}</pre>`);
				code = null;
			} else {
				code.push(rawLine);
			}
			continue;
		}
		if (/^\s*(```|~~~)/.test(rawLine)) {
			flush();
			code = [];
			continue;
		}

		// Block quotes read as ordinary text.
		const line = rawLine.replace(/^\s*(>\s?)+/, "").replace(/\s+/g, " ").trim();
		if (!line) {
			flush();
			continue;
		}

		// Setext heading: a text line underlined with === or ---.
		if (/^(=+|-+)$/.test(line) && para.length > 0 && !list) {
			const text = para.join(" ");
			para = [];
			out.push(`<h${line[0] === "=" ? 1 : 2}>${inline(text)}</h${line[0] === "=" ? 1 : 2}>`);
			continue;
		}
		// Rules, table separator rows and link definitions carry nothing to read.
		if (
			/^([-*_])( *\1){2,}$/.test(line) ||
			(line.includes("|") && /^[\s:|-]+$/.test(line)) ||
			/^\[[^\]]+\]:\s+\S+/.test(line)
		) {
			flush();
			continue;
		}

		const heading = /^(#{1,6}) (.*)$/.exec(line);
		if (heading) {
			flush();
			const n = heading[1]!.length;
			out.push(`<h${n}>${inline(stripClosingHashes(heading[2]!))}</h${n}>`);
			continue;
		}

		const item = /^([-*+]|\d+[.)])\s+(.*)$/.exec(line);
		if (item) {
			const kind = /\d/.test(item[1]!) ? "ol" : "ul";
			if (list !== kind) {
				flush();
				out.push(`<${kind}>`);
				list = kind;
			}
			out.push(`<li>${inline(item[2]!.replace(/^\[[ xX]\]\s+/, ""))}</li>`);
			continue;
		}

		if (list) {
			// A wrapped list item: join it to the item above.
			const last = out.length - 1;
			out[last] = out[last]!.replace(/<\/li>$/, ` ${inline(line)}</li>`);
			continue;
		}
		para.push(line.includes("|") ? line.replace(/\s*\|\s*/g, " ").trim() : line);
	}
	if (code) out.push(`<pre>${escapeHtml(code.join("\n"))}</pre>`);
	flush();
	return out.join("\n");
}

/** `## Title ##` → `Title`. */
function stripClosingHashes(text: string): string {
	let end = text.length;
	while (end > 0 && text[end - 1] === "#") end--;
	return end === 0 || text[end - 1] === " " ? text.slice(0, end).trimEnd() : text;
}

/** Remove `<!-- … -->` blocks; an unclosed one is left as it is. */
function stripComments(text: string): string {
	let out = "";
	let from = 0;
	for (;;) {
		const open = text.indexOf("<!--", from);
		const close = open < 0 ? -1 : text.indexOf("-->", open + 4);
		if (close < 0) return out + text.slice(from);
		out += text.slice(from, open);
		from = close + 3;
	}
}

/** Strip inline Markdown markers and escape what is left. */
function inline(text: string): string {
	return escapeHtml(
		text
			.replace(/!\[[^[\]]{0,300}\]\([^()]{0,500}\)/g, "") // images
			.replace(/\[([^[\]]{1,300})\]\([^()]{0,500}\)/g, "$1") // [text](url)
			.replace(/\[([^[\]]{1,300})\]\[[^[\]]{0,100}\]/g, "$1") // [text][ref]
			.replace(/\[\^[^[\]]{1,100}\]/g, "") // footnote markers
			.replace(/<\/?[a-zA-Z][^<>]{0,1000}>/g, "") // raw HTML tags
			.replace(/\*\*|~~|`/g, "")
			// Emphasis only at word edges, so snake_case and "2 * 3" survive.
			.replace(/(^|[\s(["'])(?:_{1,2}|\*)(?=\S)/g, "$1")
			.replace(/(?<=\S)(?:_{1,2}|\*)(?=[\s)\]"'.,;:!?]|$)/g, "")
			.replace(/\s+/g, " ")
			.trim(),
	);
}
