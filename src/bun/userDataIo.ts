import { type BrowserWindow, ipcMain } from "electron";
import { exportTtsRulesToFile } from "./ttsRulesIo";
import {
	MAX_USER_DATA_BYTES,
	readUserDataFile,
	writeUserDataFile,
} from "./userDataFiles";

/** IPC for notes, listening stats and Markdown export (see userDataFiles.ts). */
export function registerUserDataHandlers(
	getWindow: () => BrowserWindow | null,
	dataDir: () => string,
): void {
	ipcMain.handle("readUserData", (_event, params: { name?: unknown } | undefined) =>
		readUserDataFile(dataDir(), params?.name),
	);
	ipcMain.handle(
		"writeUserData",
		(_event, params: { name?: unknown; data?: unknown } | undefined) =>
			writeUserDataFile(dataDir(), params?.name, params?.data),
	);
	ipcMain.handle(
		"exportTextFile",
		(_event, params: { text?: unknown; suggestedFileName?: unknown } | undefined) => {
			const text = typeof params?.text === "string" ? params.text : "";
			if (Buffer.byteLength(text) > MAX_USER_DATA_BYTES) {
				throw new Error("This is too much text to export.");
			}
			const name =
				typeof params?.suggestedFileName === "string"
					? params.suggestedFileName
					: "notes.md";
			return exportTtsRulesToFile(getWindow(), text, name, [
				{ name: "Markdown", extensions: ["md"] },
				{ name: "All Files", extensions: ["*"] },
			]);
		},
	);
}
