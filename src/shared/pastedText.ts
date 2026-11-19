/** Title for pasted text: its first line, shortened. */
export function pastedTitle(text: string): string {
	const first = text.split("\n").find((line) => line.trim()) ?? "";
	const title = first.replace(/\s+/g, " ").trim();
	return title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title || "Pasted text";
}

/**
 * A file name (no extension) for saved pasted text: no path separators, no
 * characters Windows rejects, no leading or trailing dots.
 */
export function pastedFileBase(title: string): string {
	const safe = title
		.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 60)
		.replace(/^[.\s]+|[.\s]+$/g, "");
	return safe || "Pasted text";
}
