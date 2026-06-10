import {
	Fragment,
	createElement,
	type ReactElement,
	type ReactNode,
} from "react";
import {
	buildDomPlainTextPre,
	canonicalRangeToDisplayOffsets,
	spanCanonicalRange,
	type DomTextSpan,
} from "@shared/domPlainTextPre";
import {
	extractBodyHtml,
	htmlToPlainText,
	normalizeTextNodeContent,
	buildPreToCanonicalMap,
} from "@shared/htmlPlainText";
import {
	EPUB_BLOCK_TAGS,
	isEpubAllowedRenderTag,
	isEpubSkipTag,
	isEpubVoidNoTextTag,
} from "@shared/epubHtmlPolicy";
import type { TtsChunk } from "@/features/reader/tts/chunkText";
import { SWEEP_CLASS } from "@/features/reader/tts/sweepStore";
import { cn } from "@/lib/utils";
import { isTextSelectionClick } from "./chunkClickGuard";

export type EpubReadAlongProps = {
	chunks: TtsChunk[];
	activeChunkIndex: number | null;
	highlightRange: { start: number; end: number } | null;
	onChunkClick?: (index: number) => void;
	activeChunkRef?: (el: HTMLSpanElement | null) => void;
};

type WalkCtx = EpubReadAlongProps & {
	canonical: string;
	map: number[];
	spanByNode: WeakMap<Text, DomTextSpan>;
	keySeq: number;
};

function nextKey(ctx: WalkCtx): string {
	ctx.keySeq += 1;
	return `epub-${ctx.keySeq}`;
}

function renderTextWithChunks(
	span: DomTextSpan,
	map: number[],
	canonStart: number,
	canonEnd: number,
	ctx: WalkCtx,
): ReactNode {
	const text = span.display;

	if (!ctx.chunks.length) {
		const range = ctx.highlightRange;
		if (!range || range.start >= range.end) return text;
		if (range.end <= canonStart || range.start >= canonEnd) return text;
		const { ls, le } = canonicalRangeToDisplayOffsets(
			map,
			span,
			Math.max(range.start, canonStart),
			Math.min(range.end, canonEnd),
		);
		if (ls >= le) return text;
		return (
			<>
				{text.slice(0, ls)}
				<mark
					className={cn(
						"rounded-sm px-0.5",
						"bg-highlight text-highlight-foreground [text-decoration:none]",
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
		const { ls, le } = canonicalRangeToDisplayOffsets(
			map,
			span,
			overlapStart,
			overlapEnd,
		);

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
						"bg-highlight text-highlight-foreground ring-1 ring-highlight",
					active && SWEEP_CLASS,
					!active && "hover:bg-muted/40",
				)}
				onClick={() => {
					if (isTextSelectionClick(window.getSelection())) return;
					ctx.onChunkClick?.(chunk.index);
				}}
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

function walkElement(
	el: Element,
	ctx: WalkCtx,
): ReactNode | null {
	const tag = el.tagName.toLowerCase();
	if (isEpubSkipTag(tag)) return null;

	if (tag === "br") {
		return createElement("br", { key: nextKey(ctx) });
	}

	if (isEpubVoidNoTextTag(tag)) {
		if (tag === "img") {
			const src = el.getAttribute("src");
			const alt = el.getAttribute("alt") ?? "";
			if (!src || /^\s*javascript:/i.test(src)) return null;
			return createElement("img", {
				key: nextKey(ctx),
				src,
				alt,
				className: "my-4 max-w-full h-auto rounded-md",
				loading: "lazy",
				decoding: "async",
			});
		}
		if (tag === "hr") {
			return createElement("hr", {
				key: nextKey(ctx),
				className: "my-6 border-border",
				"aria-hidden": true,
			});
		}
		return null;
	}

	const renderedChildren: ReactNode[] = [];
	for (const child of el.childNodes) {
		const rendered = walkNode(child, ctx);
		if (rendered != null) renderedChildren.push(rendered);
	}

	if (!isEpubAllowedRenderTag(tag)) {
		return renderedChildren.length > 0 ? (
			<Fragment key={nextKey(ctx)}>{renderedChildren}</Fragment>
		) : null;
	}

	if (renderedChildren.length === 0 && !EPUB_BLOCK_TAGS.has(tag)) {
		return null;
	}

	return createElement(
		tag,
		{ key: nextKey(ctx) },
		renderedChildren.length > 0 ? renderedChildren : undefined,
	);
}

function walkNode(node: Node, ctx: WalkCtx): ReactNode | null {
	if (node.nodeType === Node.TEXT_NODE) {
		const raw = node.textContent ?? "";
		if (!raw) return null;

		const norm = normalizeTextNodeContent(raw);
		if (!norm) return null;

		const span = ctx.spanByNode.get(node as Text);
		if (!span) {
			return <Fragment key={nextKey(ctx)}>{norm}</Fragment>;
		}

		if (!span.display.trim()) {
			return <Fragment key={nextKey(ctx)}>{span.display}</Fragment>;
		}

		const { start: canonStart, end: canonEnd } = spanCanonicalRange(
			ctx.map,
			span,
		);

		return (
			<Fragment key={nextKey(ctx)}>
				{renderTextWithChunks(span, ctx.map, canonStart, canonEnd, ctx)}
			</Fragment>
		);
	}

	if (node.nodeType !== Node.ELEMENT_NODE) return null;

	return walkElement(node as Element, ctx);
}

function bodyFromHtml(html: string): HTMLElement | null {
	const fragment = extractBodyHtml(html);
	const doc = new DOMParser().parseFromString(
		`<body>${fragment}</body>`,
		"text/html",
	);
	return doc.body;
}

/** Plain text from DOM using the same rules as {@link htmlToPlainText}. */
export function plainTextFromHtmlDom(html: string): string {
	const body = bodyFromHtml(html);
	if (!body) return "";
	const { pre } = buildDomPlainTextPre(body);
	return buildPreToCanonicalMap(pre).canonical;
}

/**
 * HTML-only part of read-along rendering: DOM parse + canonical text + the
 * pre→canonical offset map. Depends solely on `html`, so callers memoize it on
 * `[html]` and keep the O(n²) {@link buildPreToCanonicalMap} off the per-chunk
 * render path (it used to rerun on every highlight tick).
 */
export type EpubReadAlongParse = {
	body: HTMLElement;
	canonical: string;
	map: number[];
	spanByNode: WeakMap<Text, DomTextSpan>;
};

export function parseEpubReadAlong(html: string): EpubReadAlongParse | null {
	const body = bodyFromHtml(html);
	if (!body) return null;

	const canonical = htmlToPlainText(html);
	const { pre, spans } = buildDomPlainTextPre(body);
	const { canonical: fromDom, map } = buildPreToCanonicalMap(pre);

	if (fromDom !== canonical) {
		console.warn(
			"EPUB DOM/TTS plain text mismatch:",
			fromDom.length,
			"vs",
			canonical.length,
		);
	}

	const spanByNode = new WeakMap<Text, DomTextSpan>();
	for (const span of spans) {
		spanByNode.set(span.node, span);
	}

	return { body, canonical, map, spanByNode };
}

/** Per-tick part: walk the parsed DOM applying the current chunk/highlight props. */
export function renderEpubReadAlong(
	parsed: EpubReadAlongParse,
	props: EpubReadAlongProps,
): ReactElement {
	const ctx: WalkCtx = {
		...props,
		canonical: parsed.canonical,
		map: parsed.map,
		spanByNode: parsed.spanByNode,
		keySeq: 0,
	};

	const children: ReactNode[] = [];
	for (const child of parsed.body.childNodes) {
		const rendered = walkNode(child, ctx);
		if (rendered != null) children.push(rendered);
	}

	return <div className="epub-chapter-body">{children}</div>;
}

/**
 * Render sanitized EPUB chapter HTML with TTS read-along highlights.
 * Highlights use the same canonical text as TTS ({@link htmlToPlainText}).
 * Prefer {@link parseEpubReadAlong} + {@link renderEpubReadAlong} in hot paths.
 */
export function renderEpubHtmlWithReadAlong(
	html: string,
	props: EpubReadAlongProps,
): ReactElement {
	const parsed = parseEpubReadAlong(html);
	if (!parsed) return <div className="epub-chapter-body" />;
	return renderEpubReadAlong(parsed, props);
}

export function plainTextMatchesTtsSource(
	html: string,
	sourceText: string,
): boolean {
	return htmlToPlainText(html) === sourceText;
}
