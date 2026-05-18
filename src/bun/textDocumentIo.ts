import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Utils } from "electrobun/bun";

export type ReadTextDocumentResult = {
	filePath: string;
	fileName: string;
	text: string;
};

function isTxtPath(path: string): boolean {
	return path.toLowerCase().endsWith(".txt");
}

export function readTextDocumentAtPath(
	filePath: string,
): ReadTextDocumentResult | null {
	if (!filePath || !isTxtPath(filePath) || !existsSync(filePath)) {
		return null;
	}
	try {
		const text = readFileSync(filePath, "utf8");
		return { filePath, fileName: basename(filePath), text };
	} catch {
		return null;
	}
}

function pathsFromOpenDialogResult(paths: string[]): string[] {
	return paths.map((p) => p.trim()).filter((p) => p.length > 0);
}

export async function pickAndReadTextDocument(): Promise<ReadTextDocumentResult | null> {
	const chosen = await Utils.openFileDialog({
		allowedFileTypes: "*",
		canChooseFiles: true,
		canChooseDirectory: false,
		allowsMultipleSelection: false,
	});
	const filePath = pathsFromOpenDialogResult(chosen)[0];
	if (!filePath) return null;
	return readTextDocumentAtPath(filePath);
}
