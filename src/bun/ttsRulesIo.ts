import { writeFile } from "node:fs/promises";
import { type BrowserWindow, dialog, shell } from "electron";

export type ExportTtsRulesFileResult = {
	cancelled: boolean;
	filePath: string | null;
};

/**
 * Ask for a destination file and write the JSON export there, then reveal it
 * in the system file manager.
 */
export async function exportTtsRulesToFile(
	parent: BrowserWindow | null,
	json: string,
	suggestedFileName: string,
): Promise<ExportTtsRulesFileResult> {
	const options = {
		defaultPath: suggestedFileName,
		filters: [
			{ name: "JSON", extensions: ["json"] },
			{ name: "All Files", extensions: ["*"] },
		],
	};
	const result = parent
		? await dialog.showSaveDialog(parent, options)
		: await dialog.showSaveDialog(options);

	if (result.canceled || !result.filePath) {
		return { cancelled: true, filePath: null };
	}

	const filePath = result.filePath;
	await writeFile(filePath, json, "utf8");

	try {
		shell.showItemInFolder(filePath);
	} catch {
		// Export still succeeded if reveal fails.
	}

	return { cancelled: false, filePath };
}
