/** Listening time for people: "2 h 10 m", "45 m", "under a minute". */
export function formatListened(sec: number): string {
	const minutes = Math.floor(sec / 60);
	if (minutes < 1) return "under a minute";
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m} m`;
	return m === 0 ? `${h} h` : `${h} h ${m} m`;
}
