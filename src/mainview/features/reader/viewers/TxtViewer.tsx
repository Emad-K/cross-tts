import { Fragment, useMemo } from "react";
import { cn } from "@/lib/utils";

type TxtViewerProps = {
	text: string;
	/** First occurrence is highlighted when set. */
	highlightPhrase?: string;
};

function splitWithHighlight(
	text: string,
	phrase: string | undefined,
): { key: string; content: string; highlight: boolean }[] {
	if (!phrase || !text.includes(phrase)) {
		return [{ key: "0", content: text, highlight: false }];
	}
	const parts: { key: string; content: string; highlight: boolean }[] = [];
	let remaining = text;
	let i = 0;
	const idx = remaining.indexOf(phrase);
	if (idx > 0) {
		parts.push({
			key: `${i++}`,
			content: remaining.slice(0, idx),
			highlight: false,
		});
	}
	parts.push({
		key: `${i++}`,
		content: phrase,
		highlight: true,
	});
	remaining = remaining.slice(idx + phrase.length);
	if (remaining.length > 0) {
		parts.push({
			key: `${i++}`,
			content: remaining,
			highlight: false,
		});
	}
	return parts;
}

/**
 * Plain-text reader surface. Replace or wrap when richer typography is needed.
 */
export function TxtViewer({ text, highlightPhrase }: TxtViewerProps) {
	const paragraphs = useMemo(() => {
		const normalized = text.replace(/\r\n/g, "\n").trimEnd();
		return normalized.split(/\n\n+/).map((block, idx) => ({
			key: `p-${idx}`,
			block,
		}));
	}, [text]);

	return (
		<div
			className={cn(
				"mx-auto w-full max-w-prose px-4 py-8 sm:px-8 sm:py-10 md:py-14",
				"font-serif text-[1.05rem] leading-[1.75] text-foreground/95 sm:text-lg sm:leading-8",
			)}
		>
			{paragraphs.map(({ key, block }) => (
				<p key={key} className="mb-6 last:mb-0">
					{splitWithHighlight(block, highlightPhrase).map((seg) => (
						<Fragment key={seg.key}>
							{seg.highlight ? (
								<mark
									className={cn(
										"rounded-sm px-0.5",
										"bg-amber-500/25 text-amber-400 [text-decoration:none]",
									)}
								>
									{seg.content}
								</mark>
							) : (
								seg.content
							)}
						</Fragment>
					))}
				</p>
			))}
		</div>
	);
}
