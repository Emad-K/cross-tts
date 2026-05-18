import {
	Fragment,
	createElement,
	type ReactElement,
	type ReactNode,
} from "react";
import {
	EPUB_BLOCK_TAGS,
	EPUB_SKIP_TAGS,
	extractBodyHtml,
	buildPreToCanonicalMap,
	finalizePlainText,
	htmlToPlainText,
	normalizeTextNodeContent,
} from "@shared/htmlPlainText";
import type { TtsChunk } from "@/features/reader/tts/chunkText";
import { cn } from "@/lib/utils";

const VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

export type EpubReadAlongProps = {
	chunks: TtsChunk[];
	activeChunkIndex: number | null;
	highlightRange: { start: number; end: number } | null;
	onChunkClick?: (index: number) => void;
	activeChunkRef?: (el: HTMLSpanElement | null) => void;
};

type WalkCtx = {
	pre: string;
	pos: number;
	offsetMap: number[];
	keySeq: number;
	chunks: TtsChunk[];
	activeChunkIndex: number | null;
	highlightRange: { start: number; end: number } | null;
	onChunkClick?: (index: number) => void;
	activeChunkRef?: (el: HTMLSpanElement | null) => void;
};

function nextKey(ctx: WalkCtx): string {
	ctx.keySeq += 1;
	return `epub-${ctx.keySeq}`;
}

function appendTagSpace(ctx: WalkCtx): void {
	ctx.pre += " ";
	ctx.pos += 1;
}

function appendBlockBreak(ctx: WalkCtx): void {
	ctx.pre += "\n\n";
	ctx.pos += 2;
}

function appendBr(ctx: WalkCtx): void {
	ctx.pre += "\n";
	ctx.pos += 1;
}

function canonAt(ctx: WalkCtx, preIndex: number): number {
	return ctx.offsetMap[preIndex] ?? 0;
}

function renderTextWithChunks(
	text: string,
	canonStart: number,
	canonEnd: number,
	ctx: WalkCtx,
): ReactNode {
	if (!ctx.chunks.length) {
		const range = ctx.highlightRange;
		if (!range || range.start >= range.end) return text;
		const ls = Math.max(0, range.start - canonStart);
		const le = Math.min(text.length, range.end - canonStart);
		if (ls >= le) return text;
		return (
			<>
				{text.slice(0, ls)}
				<mark
					className={cn(
						"rounded-sm px-0.5",
						"bg-amber-500/25 text-amber-400 [text-decoration:none]",
					)}
				>
					{text.slice(ls, le)}
				</mark>
				{text.slice(le)}
			</>
		);
	}

	const parts: ReactNode[] = [];
	let cursor = 0;

	for (const chunk of ctx.chunks) {
		if (chunk.end <= canonStart) continue;
		if (chunk.start >= canonEnd) break;

		const overlapStart = Math.max(chunk.start, canonStart);
		const overlapEnd = Math.min(chunk.end, canonEnd);
		const ls = overlapStart - canonStart;
		const le = overlapEnd - canonStart;

		if (ls > cursor) {
			parts.push(
				<Fragment key={nextKey(ctx)}>{text.slice(cursor, ls)}</Fragment>,
			);
		}

		const slice = text.slice(ls, le);
		const active = ctx.activeChunkIndex === chunk.index;
		parts.push(
			<span
				key={nextKey(ctx)}
				ref={active ? ctx.activeChunkRef : undefined}
				role="button"
				tabIndex={0}
				className={cn(
					"cursor-pointer rounded-sm transition-colors",
					active &&
						"bg-amber-500/25 text-amber-400 ring-1 ring-amber-500/40",
					!active && "hover:bg-muted/40",
				)}
				onClick={() => ctx.onChunkClick?.(chunk.index)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						ctx.onChunkClick?.(chunk.index);
					}
				}}
			>
				{slice}
			</span>,
		);
		cursor = le;
	}

	if (cursor < text.length) {
		parts.push(
			<Fragment key={nextKey(ctx)}>{text.slice(cursor)}</Fragment>,
		);
	}

	return <>{parts}</>;
}

function walkPreOnly(node: Node, ctx: WalkCtx): void {
	if (node.nodeType === Node.TEXT_NODE) {
		const raw = node.textContent ?? "";
		if (!raw) return;
		const text = normalizeTextNodeContent(raw);
		if (text) {
			ctx.pre += text;
			ctx.pos += text.length;
		}
		return;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return;

	const el = node as Element;
	const tag = el.tagName.toLowerCase();
	if (EPUB_SKIP_TAGS.has(tag)) return;

	if (tag === "br") {
		appendBr(ctx);
		return;
	}
	if (VOID_TAGS.has(tag)) {
		appendTagSpace(ctx);
		return;
	}

	appendTagSpace(ctx);
	for (const child of el.childNodes) walkPreOnly(child, ctx);
	if (EPUB_BLOCK_TAGS.has(tag)) appendBlockBreak(ctx);
	else appendTagSpace(ctx);
}

function renderNode(node: Node, ctx: WalkCtx): ReactNode {
	if (node.nodeType === Node.TEXT_NODE) {
		const raw = node.textContent ?? "";
		if (!raw) return null;
		const text = normalizeTextNodeContent(raw);
		if (!text) return null;

		const preStart = ctx.pos;
		ctx.pos += text.length;
		const preEnd = ctx.pos;
		const canonStart = canonAt(ctx, preStart);
		const canonEnd = canonAt(ctx, preEnd);

		return (
			<Fragment key={nextKey(ctx)}>
				{renderTextWithChunks(text, canonStart, canonEnd, ctx)}
			</Fragment>
		);
	}

	if (node.nodeType !== Node.ELEMENT_NODE) return null;

	const el = node as Element;
	const tag = el.tagName.toLowerCase();
	if (EPUB_SKIP_TAGS.has(tag)) return null;

	if (tag === "br") {
		appendBr(ctx);
		return createElement("br", { key: nextKey(ctx) });
	}

	if (VOID_TAGS.has(tag)) {
		appendTagSpace(ctx);
		return createElement(tag, { key: nextKey(ctx) });
	}

	appendTagSpace(ctx);

	const children: ReactNode[] = [];
	for (const child of el.childNodes) {
		const rendered = renderNode(child, ctx);
		if (rendered != null) children.push(rendered);
	}

	if (EPUB_BLOCK_TAGS.has(tag)) {
		appendBlockBreak(ctx);
	} else {
		appendTagSpace(ctx);
	}

	if (children.length === 0 && !EPUB_BLOCK_TAGS.has(tag)) {
		return null;
	}

	return createElement(
		tag,
		{ key: nextKey(ctx) },
		children.length > 0 ? children : undefined,
	);
}

function bodyFromHtml(html: string): HTMLElement | null {
	const fragment = extractBodyHtml(html);
	const doc = new DOMParser().parseFromString(
		`<body>${fragment}</body>`,
		"text/html",
	);
	return doc.body;
}

function accumulatePreFromBody(body: HTMLElement): string {
	const ctx: WalkCtx = {
		pre: "",
		pos: 0,
		offsetMap: [],
		keySeq: 0,
		chunks: [],
		activeChunkIndex: null,
		highlightRange: null,
	};
	for (const child of body.childNodes) {
		walkPreOnly(child, ctx);
	}
	return ctx.pre;
}

/** Plain text from DOM walk using the same rules as {@link htmlToPlainText}. */
export function plainTextFromHtmlDom(html: string): string {
	const body = bodyFromHtml(html);
	if (!body) return "";
	return finalizePlainText(accumulatePreFromBody(body));
}

/**
 * Render sanitized EPUB chapter HTML with TTS read-along highlights.
 */
export function renderEpubHtmlWithReadAlong(
	html: string,
	props: EpubReadAlongProps,
): ReactElement {
	const body = bodyFromHtml(html);
	if (!body) {
		return <div className="epub-chapter-body" />;
	}

	const pre = accumulatePreFromBody(body);
	const { map: offsetMap } = buildPreToCanonicalMap(pre);

	const ctx: WalkCtx = {
		...props,
		pre: "",
		pos: 0,
		offsetMap,
		keySeq: 0,
	};

	const children: ReactNode[] = [];
	for (const child of body.childNodes) {
		const rendered = renderNode(child, ctx);
		if (rendered != null) children.push(rendered);
	}

	return <div className="epub-chapter-body">{children}</div>;
}

export function plainTextMatchesTtsSource(
	html: string,
	sourceText: string,
): boolean {
	return htmlToPlainText(html) === sourceText;
}
