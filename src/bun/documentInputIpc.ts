import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { clipboard, ipcMain } from "electron";
import { dataDir } from "./appConfigStore";
import { writeFileAtomic } from "./atomicFile";
import { readPdfBytes } from "./documentIo";
import { MAX_PASTED_TEXT_BYTES } from "./fileSizeLimit";
import { pastedFileBase } from "../shared/pastedText";

function tooLong(text: string): boolean {
	return Buffer.byteLength(text, "utf8") > MAX_PASTED_TEXT_BYTES;
}

/** Write pasted text as a .txt in `<data folder>/pasted` and return its path. */
export function savePastedText(text: string, title: string): string {
	if (typeof text !== "string" || !text.trim()) throw new Error("There is no text to save.");
	if (tooLong(text)) throw new Error("That text is too long to save (the limit is 5 MB).");
	const dir = join(dataDir(), "pasted");
	mkdirSync(dir, { recursive: true });
	const base = pastedFileBase(typeof title === "string" ? title : "");
	let path = join(dir, `${base}.txt`);
	for (let n = 2; existsSync(path); n++) path = join(dir, `${base} (${n}).txt`);
	writeFileAtomic(path, text);
	return path;
}

/**
 * IPC for the formats-and-paste features. `isTrusted` is the main process's
 * own-origin check: the clipboard and the write are refused for any other
 * frame. The clipboard is read only when the renderer asks, which it does only
 * from the "Paste text" button or its shortcut.
 */
export function registerDocumentInputHandlers(
	isTrusted: (frameUrl: string | undefined) => boolean,
): void {
	ipcMain.handle("readDocumentBytes", (event, params: { filePath?: unknown } | undefined) =>
		isTrusted(event.senderFrame?.url) && typeof params?.filePath === "string"
			? readPdfBytes(params.filePath)
			: null,
	);
	ipcMain.handle("readClipboardText", async (event) => {
		if (!isTrusted(event.senderFrame?.url)) return "";
		const text = await clipboard.readText();
		if (tooLong(text)) throw new Error("The clipboard text is too long (the limit is 5 MB).");
		return text;
	});
	ipcMain.handle(
		"savePastedText",
		(event, params: { text?: unknown; title?: unknown } | undefined) => {
			if (!isTrusted(event.senderFrame?.url)) return null;
			return savePastedText(params?.text as string, params?.title as string);
		},
	);
}
