import { escapeRegexLiteral } from "@shared/ttsTextRules";

/**
 * A cleanup rule that swaps a whole word for a respelling. Unlike an IPA
 * pronunciation rule this works with every voice.
 */
export function respellRule(word: string, sayAs: string) {
	return {
		label: `Say “${word}” as “${sayAs}”`,
		// Letters and digits on either side mean it's part of a longer word.
		pattern: `(?<![\\p{L}\\p{N}])${escapeRegexLiteral(word)}(?![\\p{L}\\p{N}])`,
		replacement: sayAs.replace(/\$/g, "$$$$"),
		caseSensitive: false,
		enabled: true,
	};
}
