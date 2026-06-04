import { create } from "zustand";
import type { LogEntry, LogEntryInput } from "@shared/logEntry";

/** Cap retained entries so a long session can't grow memory without bound. */
const MAX_ENTRIES = 500;

let seq = 0;

type LogState = {
	entries: LogEntry[];
	/** Count of warn/error entries added since the panel was last marked read. */
	unreadIssues: number;
	add: (entry: LogEntryInput & { ts?: number }) => void;
	clear: () => void;
	markRead: () => void;
};

export const useLogStore = create<LogState>((set) => ({
	entries: [],
	unreadIssues: 0,

	add: (entry) =>
		set((s) => {
			seq += 1;
			const ts = entry.ts ?? Date.now();
			const full: LogEntry = {
				id: `${ts}-${seq}`,
				ts,
				level: entry.level,
				message: entry.message,
				...(entry.detail ? { detail: entry.detail } : {}),
				...(entry.source ? { source: entry.source } : {}),
			};
			const entries = [...s.entries, full].slice(-MAX_ENTRIES);
			const isIssue = entry.level !== "info";
			return {
				entries,
				unreadIssues: s.unreadIssues + (isIssue ? 1 : 0),
			};
		}),

	clear: () => set({ entries: [], unreadIssues: 0 }),
	markRead: () => set({ unreadIssues: 0 }),
}));
