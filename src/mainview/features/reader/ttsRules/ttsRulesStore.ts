import { create } from "zustand";
import {
	type PronunciationRule,
	type RegexReplaceRule,
	SLOW_RULE_MS,
	type TtsTextRulesState,
	coerceTtsTextRulesState,
	defaultTtsTextRulesState,
	effectiveTtsRules,
	setSlowTtsRuleHandler,
	ttsTextRulesSignature,
} from "@shared/ttsTextRules";
import { showToast } from "@/components/toast/toastStore";
import { logWarn } from "../logging/logger";
import {
	type ImportUserRulesMode,
	type TtsRulesExportFile,
	applyImportedUserRules,
} from "@shared/ttsRulesExchange";

type TtsRulesStore = TtsTextRulesState & {
	/**
	 * Signature of the rules in effect for {@link currentBook} (not of every
	 * stored rule), so cached audio is reused until the rules that actually
	 * apply change, and is dropped when another book's rules take over.
	 */
	signature: string;
	/** Path of the open book; its "This book" rules apply on top of the rest. */
	currentBook: string | null;
	setCurrentBook: (path: string | null) => void;
	hydrate: (raw: unknown) => void;
	setRegexEnabled: (id: string, enabled: boolean) => void;
	/** Enable/disable every regex rule in a builtin preset group (single update). */
	setRegexGroupEnabled: (group: string, enabled: boolean) => void;
	updateRegexRule: (
		id: string,
		patch: Partial<
			Pick<
				RegexReplaceRule,
				"label" | "pattern" | "replacement" | "caseSensitive" | "book"
			>
		>,
	) => void;
	addRegexRule: (rule: Omit<RegexReplaceRule, "kind" | "builtIn">) => void;
	removeRegexRule: (id: string) => void;
	setPronunciationEnabled: (id: string, enabled: boolean) => void;
	/** Enable/disable every pronunciation rule in a builtin preset group (single update). */
	setPronunciationGroupEnabled: (group: string, enabled: boolean) => void;
	updatePronunciationRule: (
		id: string,
		patch: Partial<
			Pick<PronunciationRule, "word" | "phonetic" | "caseSensitive" | "book">
		>,
	) => void;
	addPronunciationRule: (
		rule: Omit<PronunciationRule, "kind">,
	) => void;
	removePronunciationRule: (id: string) => void;
	importUserRules: (
		file: TtsRulesExportFile,
		mode: ImportUserRulesMode,
	) => void;
};

function withSignature(
	state: TtsTextRulesState,
	book: string | null,
): TtsTextRulesState & { signature: string } {
	return {
		...state,
		signature: ttsTextRulesSignature(effectiveTtsRules(state, book)),
	};
}

export const useTtsRulesStore = create<TtsRulesStore>((set, get) => {
	const initial = withSignature(defaultTtsTextRulesState(), null);
	const sign = (state: TtsTextRulesState) =>
		withSignature(state, get().currentBook);
	return {
		...initial,
		currentBook: null,
		setCurrentBook: (currentBook) =>
			set((s) =>
				s.currentBook === currentBook
					? s
					: // currentBook last: withSignature spreads the old state back in.
						{ ...withSignature(s, currentBook), currentBook },
			),
		hydrate: (raw) => set(sign(coerceTtsTextRulesState(raw))),
		setRegexEnabled: (id, enabled) =>
			set((s) =>
				sign({
					...s,
					regexRules: s.regexRules.map((r) =>
						r.id === id ? { ...r, enabled } : r,
					),
				}),
			),
		setRegexGroupEnabled: (group, enabled) =>
			set((s) =>
				sign({
					...s,
					regexRules: s.regexRules.map((r) =>
						r.group === group && r.enabled !== enabled
							? { ...r, enabled }
							: r,
					),
				}),
			),
		updateRegexRule: (id, patch) =>
			set((s) =>
				sign({
					...s,
					regexRules: s.regexRules.map((r) =>
						r.id === id && !r.builtIn ? { ...r, ...patch } : r,
					),
				}),
			),
		addRegexRule: (rule) =>
			set((s) =>
				sign({
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
				sign({
					...s,
					regexRules: s.regexRules.filter((r) => r.id !== id),
				}),
			);
		},
		setPronunciationEnabled: (id, enabled) =>
			set((s) =>
				sign({
					...s,
					pronunciationRules: s.pronunciationRules.map((r) =>
						r.id === id ? { ...r, enabled } : r,
					),
				}),
			),
		setPronunciationGroupEnabled: (group, enabled) =>
			set((s) =>
				sign({
					...s,
					pronunciationRules: s.pronunciationRules.map((r) =>
						r.group === group && r.enabled !== enabled
							? { ...r, enabled }
							: r,
					),
				}),
			),
		updatePronunciationRule: (id, patch) =>
			set((s) =>
				sign({
					...s,
					pronunciationRules: s.pronunciationRules.map((r) =>
						r.id === id ? { ...r, ...patch } : r,
					),
				}),
			),
		addPronunciationRule: (rule) =>
			set((s) =>
				sign({
					...s,
					pronunciationRules: [
						...s.pronunciationRules,
						{ ...rule, kind: "pronunciation" },
					],
				}),
			),
		removePronunciationRule: (id) => {
			const target = get().pronunciationRules.find((r) => r.id === id);
			if (target?.builtIn) return;
			set((s) =>
				sign({
					...s,
					pronunciationRules: s.pronunciationRules.filter(
						(r) => r.id !== id,
					),
				}),
			);
		},
		importUserRules: (file, mode) =>
			set((s) =>
				sign(
					applyImportedUserRules(s, file, mode, (prefix) =>
						`${prefix}-${crypto.randomUUID()}`,
					),
				),
			),
	};
});

// A custom rule that took too long on its first run gets switched off (deferred
// so the store doesn't change mid-chunking).
setSlowTtsRuleHandler((rule, ms) => {
	setTimeout(() => {
		useTtsRulesStore.getState().setRegexEnabled(rule.id, false);
		logWarn(`Disabled slow text rule "${rule.label}"`, {
			source: "tts-rules",
			detail: `took ${Math.round(ms)} ms on one chunk (limit ${SLOW_RULE_MS} ms): ${rule.pattern}`,
		});
		showToast({
			title: `Text rule "${rule.label}" was disabled`,
			description: `It took ${Math.round(ms)} ms on one chunk. Simplify the pattern before re-enabling it.`,
			variant: "destructive",
		});
	}, 0);
});

/** The rules in effect for the open book: all-books rules plus its own. */
export function getTtsRulesForEngine(): TtsTextRulesState {
	const s = useTtsRulesStore.getState();
	return effectiveTtsRules(s, s.currentBook);
}
