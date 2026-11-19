/**
 * Fixed-width `hh:mm:ss` duration formatting for countdowns and ETAs.
 *
 * Always shows zero-padded hours ("00:23:45", never "23:45") so timers don't
 * jump width when crossing the one-hour mark and the format is unambiguous.
 */

/** Whole seconds → `hh:mm:ss` (e.g. 1425 → "00:23:45"). Clamps at 0; rounds. */
export function formatHms(seconds: number): string {
	const totalSec = Number.isFinite(seconds)
		? Math.max(0, Math.round(seconds))
		: 0;
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * YouTube-style clock: `m:ss` under an hour, `h:mm:ss` from one hour up
 * (e.g. 65 → "1:05", 3725 → "1:02:05"). `forceHours` keeps the hour field so
 * both halves of an "elapsed / total" pair use the same format.
 */
export function formatClock(seconds: number, forceHours = false): string {
	const totalSec = Number.isFinite(seconds)
		? Math.max(0, Math.round(seconds))
		: 0;
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return h > 0 || forceHours ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Rough spoken-style duration for "time left" labels: "45 sec", "12 min",
 * "6 h 40 m". Minutes round up so the label never reads "0 min".
 */
export function formatDurationShort(seconds: number): string {
	const sec = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
	if (sec < 60) return `${sec} sec`;
	const min = Math.ceil(sec / 60);
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	const m = min % 60;
	return m === 0 ? `${h} h` : `${h} h ${m} m`;
}
