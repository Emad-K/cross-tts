import { create } from "zustand";
import {
	type PronunciationRule,
	type RegexReplaceRule,
	type TtsTextRulesState,
	coerceTtsTextRulesState,
	defaultTtsTextRulesState,
	ttsTextRulesSignature,
} from "@shared/ttsTextRules";
import {
	type ImportUserRulesMode,
	type TtsRulesExportFile,
	applyImportedUserRules,
} from "@shared/ttsRulesExchange";

type TtsRulesStore = TtsTextRulesState & {
	signature: string;
	hydrate: (raw: unknown) => void;
	setRegexEnabled: (id: string, enabled: boolean) => void;
	updateRegexRule: (
		id: string,
		patch: Partial<Pick<RegexReplaceRule, "label" | "pattern" | "replacement">>,
	) => void;
	addRegexRule: (rule: Omit<RegexReplaceRule, "kind" | "builtIn">) => void;
	removeRegexRule: (id: string) => void;
	setPronunciationEnabled: (id: string, enabled: boolean) => void;
	addPronunciationRule: (
		rule: Omit<PronunciationRule, "kind">,
	) => void;
	removePronunciationRule: (id: string) => void;
	importUserRules: (
		file: TtsRulesExportFile,
		mode: ImportUserRulesMode,
	) => void;
};

function withSignature(state: TtsTextRulesState): TtsTextRulesState & {
	signature: string;
} {
	return { ...state, signature: ttsTextRulesSignature(state) };
}

export const useTtsRulesStore = create<TtsRulesStore>((set, get) => {
	const initial = withSignature(defaultTtsTextRulesState());
	return {
		...initial,
		hydrate: (raw) => set(withSignature(coerceTtsTextRulesState(raw))),
		setRegexEnabled: (id, enabled) =>
			set((s) =>
				withSignature({
					...s,
					regexRules: s.regexRules.map((r) =>
						r.id === id ? { ...r, enabled } : r,
					),
				}),
			),
		updateRegexRule: (id, patch) =>
			set((s) =>
				withSignature({
					...s,
					regexRules: s.regexRules.map((r) =>
						r.id === id ? { ...r, ...patch } : r,
					),
				}),
			),
		addRegexRule: (rule) =>
			set((s) =>
				withSignature({
					...s,
					regexRules: [
						...s.regexRules,
						{ ...rule, kind: "regex", builtIn: false },
					],
				}),
			),
		removeRegexRule: (id) => {
			const target = get().regexRules.find((r) => r.id === id);
			if (!target || target.builtIn) return;
			set((s) =>
				withSignature({
					...s,
					regexRules: s.regexRules.filter((r) => r.id !== id),
				}),
			);
		},
		setPronunciationEnabled: (id, enabled) =>
			set((s) =>
				withSignature({
					...s,
					pronunciationRules: s.pronunciationRules.map((r) =>
						r.id === id ? { ...r, enabled } : r,
					),
				}),
			),
		addPronunciationRule: (rule) =>
			set((s) =>
				withSignature({
					...s,
					pronunciationRules: [
						...s.pronunciationRules,
						{ ...rule, kind: "pronunciation" },
					],
				}),
			),
		removePronunciationRule: (id) =>
			set((s) =>
				withSignature({
					...s,
					pronunciationRules: s.pronunciationRules.filter(
						(r) => r.id !== id,
					),
				}),
			),
		importUserRules: (file, mode) =>
			set((s) =>
				withSignature(
					applyImportedUserRules(s, file, mode, (prefix) =>
						`${prefix}-${crypto.randomUUID()}`,
					),
				),
			),
	};
});

export function getTtsRulesForEngine(): TtsTextRulesState {
	const { regexRules, pronunciationRules } = useTtsRulesStore.getState();
	return { regexRules, pronunciationRules };
}
