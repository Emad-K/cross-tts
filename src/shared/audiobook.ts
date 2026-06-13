/** Audiobook export formats and file-naming, shared by main + renderer. */
export type AudioFormat = "mp3" | "wav" | "m4b";

export const AUDIO_FORMATS: { id: AudioFormat; label: string; ext: string }[] = [
	{ id: "mp3", label: "MP3 (smaller)", ext: "mp3" },
	{ id: "wav", label: "WAV (lossless)", ext: "wav" },
	{ id: "m4b", label: "M4B audiobook (single file)", ext: "m4b" },
];

function formatExt(format: AudioFormat): string {
	return AUDIO_FORMATS.find((f) => f.id === format)?.ext ?? "mp3";
}

// Characters not allowed in file names on common OSes (plus ASCII control range).
const INVALID_FILENAME_CHARS = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001f]', "g");

/** Strip characters invalid in file names across OSes (keeps spaces/hyphens). */
export function sanitizeFileName(name: string): string {
	const cleaned = name
		.replace(INVALID_FILENAME_CHARS, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
	return cleaned || "chapter";
}

/** Zero-padded track file name, e.g. "007 - Chapter Title.mp3". */
export function trackFileName(
	index: number,
	title: string,
	format: AudioFormat,
): string {
	const num = String(index).padStart(3, "0");
	return `${num} - ${sanitizeFileName(title)}.${formatExt(format)}`;
}
