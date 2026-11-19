/**
 * Local listening counters. Nothing here leaves the machine: the file lives in
 * the data folder and is only read back by the Stats view.
 */
export type BookStats = {
	/** Seconds of audio actually played for this book. */
	listenedSec: number;
	/** Epoch ms of the first time the book was played to the end. */
	finishedAt?: number;
};

export type ReadingStats = {
	version: 1;
	/** Keyed by book path, like the library. */
	books: Record<string, BookStats>;
	/** Seconds listened per local calendar day (`YYYY-MM-DD`). */
	days: Record<string, number>;
};

/** Days of history kept; older days are dropped on write. */
export const MAX_STATS_DAYS = 400;
/** A day counts toward the streak once this much was listened. */
export const STREAK_MIN_SEC = 60;
/** Library progress at which a book counts as finished. */
export const FINISHED_PROGRESS = 0.995;

export function emptyReadingStats(): ReadingStats {
	return { version: 1, books: {}, days: {} };
}

/** Local calendar day of a date, as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const validSeconds = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v) && v > 0;

function pruneDays(days: Record<string, number>): Record<string, number> {
	const keys = Object.keys(days);
	if (keys.length <= MAX_STATS_DAYS) return days;
	const keep = keys.sort().slice(-MAX_STATS_DAYS);
	return Object.fromEntries(keep.map((k) => [k, days[k]!]));
}

export function coerceReadingStats(raw: unknown): ReadingStats {
	const out = emptyReadingStats();
	if (!raw || typeof raw !== "object") return out;
	const o = raw as Record<string, unknown>;
	if (o.books && typeof o.books === "object") {
		for (const [path, v] of Object.entries(o.books as Record<string, unknown>)) {
			if (!path || !v || typeof v !== "object") continue;
			const b = v as Record<string, unknown>;
			const listenedSec = validSeconds(b.listenedSec) ? b.listenedSec : 0;
			const finishedAt = validSeconds(b.finishedAt) ? b.finishedAt : undefined;
			if (listenedSec === 0 && finishedAt === undefined) continue;
			out.books[path] = { listenedSec, ...(finishedAt ? { finishedAt } : {}) };
		}
	}
	if (o.days && typeof o.days === "object") {
		for (const [day, v] of Object.entries(o.days as Record<string, unknown>)) {
			if (/^\d{4}-\d{2}-\d{2}$/.test(day) && validSeconds(v)) out.days[day] = v;
		}
		out.days = pruneDays(out.days);
	}
	return out;
}

/**
 * Merging a backup: the larger count wins per book and per day, not the sum,
 * so restoring a backup of this same computer doesn't count the time twice.
 */
export function mergeReadingStats(
	current: ReadingStats,
	incoming: ReadingStats,
): ReadingStats {
	const out: ReadingStats = {
		version: 1,
		books: { ...current.books },
		days: { ...current.days },
	};
	for (const [path, theirs] of Object.entries(incoming.books)) {
		const mine = out.books[path];
		const finished = [mine?.finishedAt, theirs.finishedAt].filter(
			(t): t is number => t !== undefined,
		);
		out.books[path] = {
			listenedSec: Math.max(mine?.listenedSec ?? 0, theirs.listenedSec),
			...(finished.length ? { finishedAt: Math.min(...finished) } : {}),
		};
	}
	for (const [day, sec] of Object.entries(incoming.days)) {
		out.days[day] = Math.max(out.days[day] ?? 0, sec);
	}
	out.days = pruneDays(out.days);
	return out;
}

/** Add listened seconds to today and (when the document is a saved book) to the book. */
export function addListening(
	stats: ReadingStats,
	path: string | null,
	sec: number,
	now: Date,
): ReadingStats {
	if (!validSeconds(sec)) return stats;
	const day = dayKey(now);
	const days = pruneDays({ ...stats.days, [day]: (stats.days[day] ?? 0) + sec });
	if (!path) return { ...stats, days };
	const book = stats.books[path];
	return {
		...stats,
		days,
		books: {
			...stats.books,
			[path]: { ...book, listenedSec: (book?.listenedSec ?? 0) + sec },
		},
	};
}

/** Record the first time a book was finished; later finishes keep the first date. */
export function markFinished(
	stats: ReadingStats,
	path: string,
	now: number,
): ReadingStats {
	const book = stats.books[path];
	if (book?.finishedAt) return stats;
	return {
		...stats,
		books: {
			...stats.books,
			[path]: { listenedSec: book?.listenedSec ?? 0, finishedAt: now },
		},
	};
}

function daysAgo(now: Date, n: number): Date {
	// Noon avoids landing on the wrong day across a DST change.
	return new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 12);
}

/** Seconds listened over the past 7 days, today included. */
export function weekSeconds(stats: ReadingStats, now: Date): number {
	let total = 0;
	for (let i = 0; i < 7; i++) total += stats.days[dayKey(daysAgo(now, i))] ?? 0;
	return total;
}

/**
 * Consecutive days with at least {@link STREAK_MIN_SEC} of listening. Today
 * extends the streak but doesn't break it, so it isn't 0 every morning.
 */
export function streak(stats: ReadingStats, now: Date): number {
	const hit = (n: number) =>
		(stats.days[dayKey(daysAgo(now, n))] ?? 0) >= STREAK_MIN_SEC;
	let count = 0;
	for (let i = hit(0) ? 0 : 1; hit(i); i++) count++;
	return count;
}
