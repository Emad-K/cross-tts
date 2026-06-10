import { describe, expect, test } from "bun:test";
import { defaultTtsTextRulesState } from "./ttsTextRules";
import {
	TTS_RULES_EXPORT_FORMAT,
	TTS_RULES_EXPORT_VERSION,
	applyImportedUserRules,
	buildTtsRulesExport,
	parseTtsRulesExport,
	serializeTtsRulesExport,
} from "./ttsRulesExchange";

describe("ttsRulesExchange", () => {
	test("export omits built-in regex rules", () => {
		const state = defaultTtsTextRulesState();
		state.regexRules.push({
			id: "custom-1",
			kind: "regex",
			label: "My rule",
			pattern: "\\d+",
			replacement: "",
			enabled: false,
			caseSensitive: true,
			builtIn: false,
		});
		const exp = buildTtsRulesExport(state);
		expect(exp.regexRules).toHaveLength(1);
		expect(exp.regexRules[0]?.enabled).toBe(false);
		expect(exp.regexRules[0]?.caseSensitive).toBe(true);
		expect(exp.format).toBe(TTS_RULES_EXPORT_FORMAT);
		expect(exp.version).toBe(TTS_RULES_EXPORT_VERSION);
	});

	test("round-trip replace keeps builtins", () => {
		const state = defaultTtsTextRulesState();
		state.pronunciationRules.push({
			id: "p1",
			kind: "pronunciation",
			word: "gif",
			phonetic: "d͡ʒɪf",
			caseSensitive: false,
			enabled: true,
		});
		const json = serializeTtsRulesExport(state);
		const parsed = parseTtsRulesExport(json);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		let id = 0;
		const merged = applyImportedUserRules(
			state,
			parsed.data,
			"replace",
			(prefix) => `${prefix}-${++id}`,
		);
		const defaults = defaultTtsTextRulesState();
		expect(merged.regexRules.filter((r) => r.builtIn)).toHaveLength(
			defaults.regexRules.filter((r) => r.builtIn).length,
		);
		expect(merged.regexRules.filter((r) => !r.builtIn)).toHaveLength(0);
		// All builtin pronunciations (qi + the default-off pinyin pack) + imported gif.
		expect(merged.pronunciationRules.filter((r) => r.builtIn)).toHaveLength(
			defaults.pronunciationRules.filter((r) => r.builtIn).length,
		);
		expect(merged.pronunciationRules.find((r) => r.word === "gif")).toBeTruthy();
		expect(merged.pronunciationRules.find((r) => r.id === "builtin-pron-qi")).toBeTruthy();
	});

	test("rejects invalid format", () => {
		const r = parseTtsRulesExport('{"format":"other","version":1}');
		expect(r.ok).toBe(false);
	});
});
