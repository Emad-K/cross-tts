/**
 * Appearance settings: color mode (light/dark/system), a named theme palette
 * (each with light + dark variants), the reading font, and a font-size
 * multiplier (1 = default). Shared so main + renderer agree on the shape.
 */
export type ColorMode = "system" | "light" | "dark";
export type ThemeId = "default" | "slate" | "rose" | "mac" | "sepia";
export type FontId =
	| "serif"
	| "sans"
	| "inter"
	| "atkinson"
	| "literata"
	| "lora"
	| "opendyslexic";

export type ReaderPadding = "comfortable" | "compact" | "tight";

export type Appearance = {
	mode: ColorMode;
	theme: ThemeId;
	fontFamily: FontId;
	/** Reading font-size multiplier (1 = default). */
	fontScale: number;
	/** Padding around the reading text. */
	readerPadding: ReaderPadding;
	/** Max characters per TTS chunk. */
	maxChunkChars: number;
};

export const THEMES: { id: ThemeId; label: string }[] = [
	{ id: "default", label: "Default" },
	{ id: "slate", label: "Slate" },
	{ id: "rose", label: "Rosé" },
	{ id: "mac", label: "macOS" },
	{ id: "sepia", label: "Sepia" },
];

export const FONTS: { id: FontId; label: string; stack: string }[] = [
	{
		id: "serif",
		label: "Serif (default)",
		stack: 'Georgia, "Times New Roman", ui-serif, serif',
	},
	{
		id: "sans",
		label: "System Sans",
		stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
	},
	{ id: "inter", label: "Inter", stack: '"Inter", system-ui, sans-serif' },
	{
		id: "atkinson",
		label: "Atkinson Hyperlegible",
		stack: '"Atkinson Hyperlegible", system-ui, sans-serif',
	},
	{ id: "literata", label: "Literata", stack: '"Literata", Georgia, serif' },
	{ id: "lora", label: "Lora", stack: '"Lora", Georgia, serif' },
	{
		id: "opendyslexic",
		label: "OpenDyslexic",
		stack: '"OpenDyslexic", system-ui, sans-serif',
	},
];

export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.6;
export const FONT_SCALE_STEP = 0.1;

export const READER_PADDINGS: { id: ReaderPadding; label: string }[] = [
	{ id: "comfortable", label: "Comfortable" },
	{ id: "compact", label: "Compact" },
	{ id: "tight", label: "Tight" },
];

/** Horizontal / vertical padding (rem) for each reader-padding level. */
export const READER_PADDING_VALUES: Record<
	ReaderPadding,
	{ x: number; y: number }
> = {
	comfortable: { x: 2, y: 3.5 },
	compact: { x: 1, y: 2 },
	tight: { x: 0.5, y: 1 },
};

export const MAX_CHUNK_CHARS_MIN = 120;
export const MAX_CHUNK_CHARS_MAX = 600;
export const MAX_CHUNK_CHARS_STEP = 20;
export const MAX_CHUNK_CHARS_DEFAULT = 240;

export const defaultAppearance = (): Appearance => ({
	mode: "system",
	theme: "default",
	fontFamily: "serif",
	fontScale: 1,
	readerPadding: "comfortable",
	maxChunkChars: MAX_CHUNK_CHARS_DEFAULT,
});

export function fontStack(id: FontId): string {
	return FONTS.find((f) => f.id === id)?.stack ?? FONTS[0]!.stack;
}

export function coerceAppearance(raw: unknown): Appearance {
	const d = defaultAppearance();
	if (!raw || typeof raw !== "object") return d;
	const o = raw as Record<string, unknown>;
	if (o.mode === "system" || o.mode === "light" || o.mode === "dark") {
		d.mode = o.mode;
	}
	if (THEMES.some((t) => t.id === o.theme)) d.theme = o.theme as ThemeId;
	if (FONTS.some((f) => f.id === o.fontFamily)) {
		d.fontFamily = o.fontFamily as FontId;
	}
	if (typeof o.fontScale === "number" && Number.isFinite(o.fontScale)) {
		d.fontScale = Math.min(
			FONT_SCALE_MAX,
			Math.max(FONT_SCALE_MIN, o.fontScale),
		);
	}
	if (
		o.readerPadding === "comfortable" ||
		o.readerPadding === "compact" ||
		o.readerPadding === "tight"
	) {
		d.readerPadding = o.readerPadding;
	}
	if (typeof o.maxChunkChars === "number" && Number.isFinite(o.maxChunkChars)) {
		d.maxChunkChars = Math.min(
			MAX_CHUNK_CHARS_MAX,
			Math.max(MAX_CHUNK_CHARS_MIN, Math.round(o.maxChunkChars)),
		);
	}
	return d;
}
