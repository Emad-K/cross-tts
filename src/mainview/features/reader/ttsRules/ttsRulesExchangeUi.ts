import {
	exportFilenameForDate,
	serializeTtsRulesExport,
} from "@shared/ttsRulesExchange";
import type { TtsTextRulesState } from "@shared/ttsTextRules";
import {
	exportTtsRulesToFile as exportTtsRulesToFileRpc,
	isElectrobunWebview,
} from "@/lib/electrobunRpc";

export type ExportTtsRulesUiResult =
	| { ok: true; filePath: string; via: "native" }
	| { ok: true; filePath: null; via: "browser-download" }
	| { ok: false; cancelled: true }
	| { ok: false; error: string };

export function countExportableRules(state: TtsTextRulesState): number {
	const json = serializeTtsRulesExport(state, false);
	const parsed = JSON.parse(json) as {
		regexRules: unknown[];
		pronunciationRules: unknown[];
	};
	return parsed.regexRules.length + parsed.pronunciationRules.length;
}

function downloadViaBrowser(json: string, filename: string): void {
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

export async function exportTtsRulesForUser(
	state: TtsTextRulesState,
): Promise<ExportTtsRulesUiResult> {
	const count = countExportableRules(state);
	if (count === 0) {
		return { ok: false, error: "No custom rules to export." };
	}

	const filename = exportFilenameForDate();
	const json = serializeTtsRulesExport(state, true);

	if (isElectrobunWebview()) {
		const result = await exportTtsRulesToFileRpc(json, filename);
		if (result.cancelled) {
			return { ok: false, cancelled: true };
		}
		if (!result.filePath) {
			return { ok: false, error: "Export did not save a file." };
		}
		return { ok: true, filePath: result.filePath, via: "native" };
	}

	downloadViaBrowser(json, filename);
	return { ok: true, filePath: null, via: "browser-download" };
}
