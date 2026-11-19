import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { MAX_TXT_BYTES, assertDocumentSize } from "./fileSizeLimit";

function isTxtPath(path: string): boolean {
	return path.toLowerCase().endsWith(".txt");
}

export function readTextDocumentAtPath(
	filePath: string,
): { format: "txt"; filePath: string; fileName: string; text: string } | null {
	if (!filePath || !isTxtPath(filePath)) return null;
	let size: number;
	try {
		const st = statSync(filePath);
		if (!st.isFile()) return null;
		size = st.size;
	} catch {
		return null;
	}
	assertDocumentSize(filePath, size, MAX_TXT_BYTES);
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
