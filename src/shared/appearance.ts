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

export type Appearance = {
	mode: ColorMode;
	theme: ThemeId;
	fontFamily: FontId;
	/** Reading font-size multiplier (1 = default). */
	fontScale: number;
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

export const defaultAppearance = (): Appearance => ({
	mode: "system",
	theme: "default",
	fontFamily: "serif",
	fontScale: 1,
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
	return d;
}
