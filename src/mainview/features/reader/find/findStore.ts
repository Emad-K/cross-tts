import { create } from "zustand";

type FindStore = {
	/** Whether the in-chapter find bar is visible. */
	open: boolean;
	/** Text the bar starts with (e.g. the context-menu selection). */
	initialQuery: string;
	/**
	 * Bumped on every {@link openFind} so the bar remounts (re-focuses and
	 * re-runs the query) even when it is already open.
	 */
	requestId: number;
	/** Open the find bar, optionally pre-filled with a query. */
	openFind: (query?: string) => void;
	closeFind: () => void;
};

/**
 * Shared open/close state for the in-chapter find bar, so callers outside the
 * reader shell (keyboard shortcut, viewer context menu) can open it.
 */
export const useFindStore = create<FindStore>((set) => ({
	open: false,
	initialQuery: "",
	requestId: 0,
	openFind: (query) =>
		set((s) => ({
			open: true,
			initialQuery: query ?? "",
			requestId: s.requestId + 1,
		})),
	closeFind: () => set({ open: false, initialQuery: "" }),
}));
