import { create } from "zustand";

/**
 * Transient 0..1 progress through the currently-playing chunk, driven by the
 * playback loop (real-time, from the audio clock). Kept in its own store — NOT
 * {@link useTtsStore} — because it updates every animation frame, and the
 * session-save subscriber on the TTS store would otherwise never settle.
 *
 * Viewers read it imperatively (setting a CSS variable on the active chunk) so
 * the sweep animates without re-rendering React each frame.
 */
type SweepStore = {
	progress: number;
	setProgress: (p: number) => void;
};

export const useSweepStore = create<SweepStore>((set) => ({
	progress: 0,
	setProgress: (progress) => set({ progress }),
}));

/** CSS for the active chunk's left-to-right "played" sweep (Tailwind arbitrary). */
export const SWEEP_CLASS =
	"[background-image:linear-gradient(to_right,rgb(0_0_0/0.16)_var(--sweep,0%),transparent_var(--sweep,0%))]";

/** Bind the sweep store to one element's `--sweep` CSS var; returns an unsubscribe. */
export function bindSweep(el: HTMLElement): () => void {
	const apply = (p: number) => {
		el.style.setProperty("--sweep", `${(p * 100).toFixed(1)}%`);
	};
	apply(useSweepStore.getState().progress);
	return useSweepStore.subscribe((s) => apply(s.progress));
}
