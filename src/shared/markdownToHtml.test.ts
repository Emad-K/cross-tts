import { expect, test } from "bun:test";
import { markdownToHtml } from "./markdownToHtml";

test("headings, lists, code and paragraphs", () => {
	expect(
		markdownToHtml(
			"# One #\n\ntext *here*\nand __there__\n\n* a\n* b\n\n1) c\n\n~~~\n<x> & y\n~~~\nTwo\n---\n| a | b |\n|---|---|\n| 1 | 2 |",
		),
	).toBe(
		[
			"<h1>One</h1>",
			"<p>text here and there</p>",
			"<ul>",
			"<li>a</li>",
			"<li>b</li>",
			"</ul>",
			"<ol>",
			"<li>c</li>",
			"</ol>",
			"<pre>&lt;x&gt; &amp; y</pre>",
			"<h2>Two</h2>",
			"<p>a b</p>",
			"<p>1 2</p>",
		].join("\n"),
	);
});

test("links keep their text; images, comments and raw tags go", () => {
	expect(
		markdownToHtml("See [the docs](http://x.test/a) ![img](a.png)<br> now.<!-- hidden\n\nstill hidden -->\n\n[ref]: http://x.test"),
	).toBe("<p>See the docs now.</p>");
	expect(markdownToHtml("a < b and C# stays")).toBe("<p>a &lt; b and C# stays</p>");
});

test("hostile input stays fast", () => {
	const started = performance.now();
	for (const unit of ["[", "<a", "<!--", "![", "# ", "|", "- ", "*", "[a]("]) {
		markdownToHtml(unit.repeat(200_000));
		markdownToHtml(`# ${unit.repeat(200_000)}x`);
	}
	expect(performance.now() - started).toBeLessThan(5000);
});
