import { useEffect, useRef } from "react";
import { pastedTitle } from "@shared/pastedText";
import { showToast } from "@/components/toast/toastStore";
import { ipcErrorMessage } from "@/lib/desktopBridge";
import { useTtsStore } from "../tts";
import type { LoadedDocument } from "../types";

/**
 * "Paste text": read the clipboard into a temporary document. Nothing is
 * written anywhere until the user chooses "Save to library", which stores the
 * text as a .txt in the app's data folder.
 *
 * The clipboard is read in the main process (the renderer has no clipboard-read
 * permission), and only from `pasteText`, which runs on the button or shortcut.
 */

type TextDocument = Extract<LoadedDocument, { format: "txt" }>;

type Handlers = {
	getDocument: () => LoadedDocument | null;
	/** Open a document from scratch (position 0). */
	open: (doc: TextDocument) => void;
	/** Swap the open document for its saved copy, keeping the place. */
	replace: (doc: TextDocument, chunkIndex: number) => void;
};

let current: Handlers | null = null;

export const PASTE_SHORTCUT_LABEL =
	typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
		? "⌘⇧V"
		: "Ctrl+Shift+V";

/** True for pasted text that hasn't been saved to the library yet. */
export function isUnsavedPaste(doc: LoadedDocument | null): doc is TextDocument {
	return doc?.format === "txt" && doc.pasted === true && !doc.filePath;
}

/** Read the clipboard and open its text. Call only from a user action. */
export async function pasteText(): Promise<void> {
	const handlers = current;
	if (!handlers) return;
	let text: string;
	try {
		text = await (window.api
			? window.api.request.readClipboardText()
			: navigator.clipboard.readText());
	} catch (err) {
		showToast({
			title: "Couldn't read the clipboard",
			description: ipcErrorMessage(err),
			variant: "destructive",
		});
		return;
	}
	if (!text.trim()) {
		showToast({
			title: "Nothing to paste",
			description: "Copy some text first, then choose Paste text.",
		});
		return;
	}
	handlers.open({ format: "txt", fileName: pastedTitle(text), pasted: true, text });
	if (!window.api) return; // saving needs the desktop app
	showToast({
		title: "Reading pasted text",
		description: "It isn't saved yet.",
		action: { label: "Save to library", onClick: () => void savePastedText() },
		durationMs: 8000,
	});
}

/** Save the open pasted text into the library and keep reading from the same spot. */
export async function savePastedText(): Promise<void> {
	const handlers = current;
	const doc = handlers?.getDocument() ?? null;
	if (!handlers || !isUnsavedPaste(doc) || !window.api) return;
	try {
		const filePath = await window.api.request.savePastedText({
			text: doc.text,
			title: doc.fileName,
		});
		// The user may have moved on while the file was being written.
		if (!filePath || handlers.getDocument() !== doc) return;
		handlers.replace(
			{
				format: "txt",
				fileName: filePath.split(/[\\/]/).pop() ?? doc.fileName,
				filePath,
				text: doc.text,
			},
			useTtsStore.getState().currentChunkIndex,
		);
		showToast({ title: "Saved to your library" });
	} catch (err) {
		showToast({
			title: "Couldn't save the text",
			description: ipcErrorMessage(err),
			variant: "destructive",
		});
	}
}

/**
 * Mount once (ReaderApp): connects `pasteText` / `savePastedText` to the
 * reader and binds Ctrl/Cmd+Shift+V. The shortcut is left alone while typing
 * in a field (there it is the system's "paste as plain text") and while a
 * dialog is open.
 */
export function usePasteText(handlers: Handlers): void {
	const latest = useRef(handlers);
	latest.current = handlers;
	useEffect(() => {
		current = {
			getDocument: () => latest.current.getDocument(),
			open: (doc) => latest.current.open(doc),
			replace: (doc, chunkIndex) => latest.current.replace(doc, chunkIndex),
		};
		const onKey = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
			if (e.key.toLowerCase() !== "v") return;
			const target = e.target instanceof Element ? e.target : null;
			if (target?.closest("input, textarea, select, [contenteditable]")) return;
			if (document.querySelector('[role="dialog"]')) return;
			e.preventDefault();
			void pasteText();
		};
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			current = null;
		};
	}, []);
}
