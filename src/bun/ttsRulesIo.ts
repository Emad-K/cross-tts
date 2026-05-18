import { join } from "node:path";
import { Utils } from "electrobun/bun";

export type ExportTtsRulesFileResult = {
	cancelled: boolean;
	filePath: string | null;
};

/**
 * Ask for a destination folder and write the JSON export there, then reveal it
 * in the system file manager.
 */
export async function exportTtsRulesToFile(
	json: string,
	suggestedFileName: string,
): Promise<ExportTtsRulesFileResult> {
	const chosen = await Utils.openFileDialog({
		startingFolder: "~/",
		allowedFileTypes: "*",
		canChooseFiles: false,
		canChooseDirectory: true,
		allowsMultipleSelection: false,
	});

	const dir = chosen[0]?.trim();
	if (!dir) {
		return { cancelled: true, filePath: null };
	}

	const filePath = join(dir, suggestedFileName);
	await Bun.write(filePath, json);

	try {
		Utils.showItemInFolder(filePath);
	} catch {
		// Export still succeeded if reveal fails.
	}

	return { cancelled: false, filePath };
}
