import { create } from "zustand";

export type ToastAction = {
	label: string;
	onClick: () => void;
};

export type ToastEntry = {
	id: number;
	title: string;
	description?: string;
	variant: "default" | "destructive";
	action?: ToastAction;
};

type ToastStore = {
	toasts: ToastEntry[];
	add: (toast: ToastEntry) => void;
	dismiss: (id: number) => void;
};

export const useToastStore = create<ToastStore>((set) => ({
	toasts: [],
	add: (toast) => set((s) => ({ toasts: [...s.toasts, toast] })),
	dismiss: (id) =>
		set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const DEFAULT_DURATION_MS = 5000;

let nextId = 1;

/**
 * Show an in-app toast. Auto-dismisses after `durationMs` (default 5s);
 * pass `durationMs: null` for a sticky toast (e.g. "update ready") that stays
 * until the user dismisses it or triggers its action.
 */
export function showToast(input: {
	title: string;
	description?: string;
	variant?: "default" | "destructive";
	action?: ToastAction;
	durationMs?: number | null;
}): number {
	const id = nextId++;
	useToastStore.getState().add({
		id,
		title: input.title,
		description: input.description,
		variant: input.variant ?? "default",
		action: input.action,
	});
	const duration =
		input.durationMs === undefined ? DEFAULT_DURATION_MS : input.durationMs;
	if (duration !== null) {
		setTimeout(() => dismissToast(id), duration);
	}
	return id;
}

export function dismissToast(id: number): void {
	useToastStore.getState().dismiss(id);
}
