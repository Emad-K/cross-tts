import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

function isTxtPath(path: string): boolean {
	return path.toLowerCase().endsWith(".txt");
}

export function readTextDocumentAtPath(
	filePath: string,
): { format: "txt"; filePath: string; fileName: string; text: string } | null {
	if (!filePath || !isTxtPath(filePath) || !existsSync(filePath)) {
		return null;
	}
	try {
		const text = readFileSync(filePath, "utf8");
		return {
			format: "txt",
			filePath,
			fileName: basename(filePath),
			text,
		};
	} catch {
		return null;
	}
}

