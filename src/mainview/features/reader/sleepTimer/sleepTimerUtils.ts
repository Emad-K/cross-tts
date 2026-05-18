/** Wall-clock duration from minutes. */
export function minutesToMs(minutes: number): number {
	return minutes * 60 * 1000;
}

/** Format remaining time as `m:ss` or `h:mm:ss`. */
export function formatSleepRemaining(ms: number): string {
	const totalSec = Math.max(0, Math.ceil(ms / 1000));
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) {
		return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	}
	return `${m}:${String(s).padStart(2, "0")}`;
}

export function parseCustomSleepMinutes(raw: string): number | null {
	const n = Number.parseInt(raw.trim(), 10);
	if (!Number.isFinite(n) || n < 1 || n > 24 * 60) return null;
	return n;
}
