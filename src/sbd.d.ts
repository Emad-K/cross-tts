declare module "sbd" {
	export function sentences(
		text: string,
		options?: {
			preserve_whitespace?: boolean;
			newline_boundaries?: boolean;
			html_boundaries?: boolean;
			abbreviations?: string[] | null;
			[key: string]: unknown;
		},
	): string[];
}
