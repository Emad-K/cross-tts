import { useEffect } from "react";
import {
	type Appearance,
	READER_PADDING_VALUES,
	fontStack,
} from "@shared/appearance";
import { useAppSettingsStore } from "./appSettingsStore";

function prefersDark(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches
	);
}

function resolveDark(mode: Appearance["mode"]): boolean {
	if (mode === "dark") return true;
	if (mode === "light") return false;
	return prefersDark();
}

/** Apply theme/mode/font to <html> via class, data-theme, and CSS vars. */
export function applyAppearance(a: Appearance): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	root.classList.toggle("dark", resolveDark(a.mode));
	if (a.theme === "default") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", a.theme);
	root.style.setProperty("--reader-font", fontStack(a.fontFamily));
	root.style.setProperty("--reader-scale", String(a.fontScale));
	const pad = READER_PADDING_VALUES[a.readerPadding] ?? READER_PADDING_VALUES.comfortable;
	root.style.setProperty("--reader-pad-x", `${pad.x}rem`);
	root.style.setProperty("--reader-pad-y", `${pad.y}rem`);
}

/** Keep the DOM in sync with the appearance setting (and the OS theme on system). */
export function useAppearanceSync(): void {
	const appearance = useAppSettingsStore((s) => s.config?.appearance);
	useEffect(() => {
		if (!appearance) return;
		applyAppearance(appearance);
		if (appearance.mode !== "system" || typeof window === "undefined") return;
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyAppearance(appearance);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, [appearance]);
}
