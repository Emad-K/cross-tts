import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { parseTtsRulesExport } from "@shared/ttsRulesExchange";
import type { PronunciationRule, RegexReplaceRule } from "@shared/ttsTextRules";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTtsRulesStore } from "../ttsRules/ttsRulesStore";
import { exportTtsRulesForUser } from "../ttsRules/ttsRulesExchangeUi";

export type TtsRulesPanelProps = {
	/** True when this panel is the active settings section (drives scroll-into-view). */
	active: boolean;
};

function newId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

const SCROLL_AREA_VIEWPORT = "[data-radix-scroll-area-viewport]";

/** Scroll nested shadcn ScrollAreas so an inline edit form is visible. */
function scrollToInlineEditTarget(
	element: HTMLElement,
	behavior: ScrollBehavior = "smooth",
) {
	element.scrollIntoView({ block: "nearest", inline: "nearest", behavior });

	let node: HTMLElement | null = element.parentElement;
	while (node) {
		if (node.matches(SCROLL_AREA_VIEWPORT)) {
			const elRect = element.getBoundingClientRect();
			const vpRect = node.getBoundingClientRect();
			const pad = 8;
			if (elRect.top < vpRect.top + pad) {
				node.scrollTop += elRect.top - vpRect.top - pad;
			} else if (elRect.bottom > vpRect.bottom - pad) {
				node.scrollTop += elRect.bottom - vpRect.bottom + pad;
			}
		}
		node = node.parentElement;
	}
}

type RegexFormDraft = {
	label: string;
	pattern: string;
	replacement: string;
	caseSensitive: boolean;
};

type PronFormDraft = {
	word: string;
	phonetic: string;
	caseSensitive: boolean;
};

function RuleRow({
	enabled,
	onEnabledChange,
	checkboxId,
	title,
	actions,
}: {
	enabled: boolean;
	onEnabledChange: (v: boolean) => void;
	checkboxId: string;
	title: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<li
			className={cn(
				"flex items-center gap-2 rounded-md border border-border px-2 py-1.5",
				!enabled && "opacity-60",
			)}
		>
			<Checkbox
				id={checkboxId}
				checked={enabled}
				onCheckedChange={(v) => onEnabledChange(v === true)}
				className="shrink-0"
			/>
			<Label
				htmlFor={checkboxId}
				className="min-w-0 flex-1 cursor-pointer text-sm font-medium leading-snug"
			>
				{title}
			</Label>
			{actions ? (
				<div className="flex shrink-0 items-center gap-0.5">{actions}</div>
			) : null}
		</li>
	);
}

function RulesEmptyState({ message }: { message: string }) {
	return (
		<div
			className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border/70 bg-muted/10 px-4 py-6 text-center text-sm leading-relaxed text-muted-foreground"
			role="status"
		>
			{message}
		</div>
	);
}

function RulesAccordionSection({
	value,
	title,
	ruleCount,
	isEmpty,
	emptyMessage,
	addLabel,
	addFormOpen,
	onAddClick,
	list,
	footer,
}: {
	value: string;
	title: string;
	ruleCount: number;
	isEmpty: boolean;
	emptyMessage: string;
	addLabel: string;
	addFormOpen: boolean;
	onAddClick: () => void;
	list: ReactNode;
	footer?: ReactNode;
}) {
	return (
		<AccordionItem value={value} className="border-border">
			<AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
				<span className="flex min-w-0 flex-1 items-center gap-2 text-left">
					<span>{title}</span>
					<span
						className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal tabular-nums text-muted-foreground"
						aria-hidden
					>
						{ruleCount}
					</span>
				</span>
			</AccordionTrigger>
			<AccordionContent>
				<div className="flex flex-col gap-2.5 pb-1">
					<ScrollArea className="h-[min(15rem,40vh)] w-full rounded-md border border-border/60 bg-muted/5">
						<div className="p-1.5 pr-3">
							{isEmpty ? <RulesEmptyState message={emptyMessage} /> : list}
						</div>
					</ScrollArea>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-full shrink-0 gap-1.5 sm:w-auto"
						aria-expanded={addFormOpen}
						onClick={onAddClick}
					>
						<Plus className="size-4" aria-hidden />
						{addLabel}
					</Button>
					{footer}
				</div>
			</AccordionContent>
		</AccordionItem>
	);
}

function IconAction({
	label,
	onClick,
	children,
	destructive,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
	destructive?: boolean;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			className={cn(
				"size-8 text-muted-foreground",
				destructive && "hover:text-destructive",
			)}
			aria-label={label}
			onClick={onClick}
		>
			{children}
		</Button>
	);
}

function InlineRegexForm({
	draft,
	error,
	submitLabel,
	onDraftChange,
	onSubmit,
	onCancel,
}: {
	draft: RegexFormDraft;
	error: string | null;
	submitLabel: string;
	onDraftChange: (patch: Partial<RegexFormDraft>) => void;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="space-y-2 rounded-md border border-dashed border-border bg-muted/20 p-3">
			<Input
				placeholder="Label (optional)"
				value={draft.label}
				onChange={(e) => onDraftChange({ label: e.target.value })}
			/>
			<Input
				placeholder="Regex pattern"
				value={draft.pattern}
				onChange={(e) => onDraftChange({ pattern: e.target.value })}
				className="font-mono text-sm"
				spellCheck={false}
			/>
			<Input
				placeholder="Replacement (leave empty to remove)"
				value={draft.replacement}
				onChange={(e) => onDraftChange({ replacement: e.target.value })}
				className="font-mono text-sm"
				spellCheck={false}
			/>
			<div className="flex items-center gap-2">
				<Checkbox
					id="regex-form-case"
					checked={draft.caseSensitive}
					onCheckedChange={(v) => onDraftChange({ caseSensitive: v === true })}
				/>
				<Label htmlFor="regex-form-case" className="cursor-pointer text-sm">
					Case sensitive
				</Label>
			</div>
			{error ? <p className="text-xs text-destructive">{error}</p> : null}
			<div className="flex flex-wrap gap-2">
				<Button type="button" size="sm" onClick={onSubmit}>
					{submitLabel}
				</Button>
				<Button type="button" size="sm" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

function InlinePronForm({
	draft,
	error,
	submitLabel,
	onDraftChange,
	onSubmit,
	onCancel,
}: {
	draft: PronFormDraft;
	error: string | null;
	submitLabel: string;
	onDraftChange: (patch: Partial<PronFormDraft>) => void;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="space-y-2 rounded-md border border-dashed border-border bg-muted/20 p-3">
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="space-y-1">
					<Label htmlFor="pron-form-word">Word</Label>
					<Input
						id="pron-form-word"
						placeholder="Los Angeles"
						value={draft.word}
						onChange={(e) => onDraftChange({ word: e.target.value })}
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="pron-form-ipa">Phonetic (IPA)</Label>
					<Input
						id="pron-form-ipa"
						placeholder="lɔs ˈænd͡ʒɛləs"
						value={draft.phonetic}
						onChange={(e) => onDraftChange({ phonetic: e.target.value })}
						className="font-mono text-sm"
					/>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Checkbox
					id="pron-form-case"
					checked={draft.caseSensitive}
					onCheckedChange={(v) => onDraftChange({ caseSensitive: v === true })}
				/>
				<Label htmlFor="pron-form-case" className="cursor-pointer text-sm">
					Case sensitive
				</Label>
			</div>
			{error ? <p className="text-xs text-destructive">{error}</p> : null}
			<div className="flex flex-wrap gap-2">
				<Button type="button" size="sm" onClick={onSubmit}>
					{submitLabel}
				</Button>
				<Button type="button" size="sm" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

/**
 * Text-cleanup and pronunciation rules editor. Rendered as a section inside the
 * unified Settings dialog (see {@link SettingsDialog}).
 */
export function TtsRulesPanel({ active }: TtsRulesPanelProps) {
	const regexRules = useTtsRulesStore((s) => s.regexRules);
	const pronunciationRules = useTtsRulesStore((s) => s.pronunciationRules);
	const setRegexEnabled = useTtsRulesStore((s) => s.setRegexEnabled);
	const updateRegexRule = useTtsRulesStore((s) => s.updateRegexRule);
	const addRegexRule = useTtsRulesStore((s) => s.addRegexRule);
	const removeRegexRule = useTtsRulesStore((s) => s.removeRegexRule);
	const setPronunciationEnabled = useTtsRulesStore(
		(s) => s.setPronunciationEnabled,
	);
	const updatePronunciationRule = useTtsRulesStore(
		(s) => s.updatePronunciationRule,
	);
	const addPronunciationRule = useTtsRulesStore((s) => s.addPronunciationRule);
	const removePronunciationRule = useTtsRulesStore(
		(s) => s.removePronunciationRule,
	);
	const importUserRules = useTtsRulesStore((s) => s.importUserRules);

	const importInputRef = useRef<HTMLInputElement>(null);
	const [importError, setImportError] = useState<string | null>(null);
	const [importNotice, setImportNotice] = useState<string | null>(null);

	const emptyRegexDraft = (): RegexFormDraft => ({
		label: "",
		pattern: "",
		replacement: "",
		caseSensitive: false,
	});
	const emptyPronDraft = (): PronFormDraft => ({
		word: "",
		phonetic: "",
		caseSensitive: false,
	});

	/** null = closed, "add" = new rule, else rule id being edited */
	const [regexFormKey, setRegexFormKey] = useState<"add" | string | null>(null);
	const [regexDraft, setRegexDraft] = useState<RegexFormDraft>(emptyRegexDraft);
	const [regexError, setRegexError] = useState<string | null>(null);

	const [pronFormKey, setPronFormKey] = useState<"add" | string | null>(null);
	const [pronDraft, setPronDraft] = useState<PronFormDraft>(emptyPronDraft);
	const [pronError, setPronError] = useState<string | null>(null);

	const inlineEditRef = useRef<HTMLDivElement | null>(null);

	const editingRuleId =
		regexFormKey && regexFormKey !== "add"
			? regexFormKey
			: pronFormKey && pronFormKey !== "add"
				? pronFormKey
				: null;

	useLayoutEffect(() => {
		if (!active || !editingRuleId) return;

		const scroll = () => {
			const el = inlineEditRef.current;
			if (el) scrollToInlineEditTarget(el);
		};

		const t1 = window.setTimeout(scroll, 0);
		const t2 = window.setTimeout(scroll, 220);

		return () => {
			window.clearTimeout(t1);
			window.clearTimeout(t2);
		};
	}, [active, editingRuleId]);

	const closeRegexForm = () => {
		setRegexFormKey(null);
		setRegexDraft(emptyRegexDraft());
		setRegexError(null);
	};

	const closePronForm = () => {
		setPronFormKey(null);
		setPronDraft(emptyPronDraft());
		setPronError(null);
	};

	const openAddRegex = () => {
		closePronForm();
		setRegexFormKey("add");
		setRegexDraft(emptyRegexDraft());
		setRegexError(null);
	};

	const openEditRegex = (rule: RegexReplaceRule) => {
		if (rule.builtIn) return;
		closePronForm();
		setRegexFormKey(rule.id);
		setRegexDraft({
			label: rule.label,
			pattern: rule.pattern,
			replacement: rule.replacement,
			caseSensitive: rule.caseSensitive,
		});
		setRegexError(null);
	};

	const validateRegexDraft = (): string | null => {
		const pattern = regexDraft.pattern.trim();
		if (!pattern) return "Enter a regex pattern.";
		try {
			void new RegExp(pattern, regexDraft.caseSensitive ? "u" : "iu");
		} catch {
			return "Invalid regular expression.";
		}
		return null;
	};

	const submitRegexAdd = () => {
		const err = validateRegexDraft();
		if (err) {
			setRegexError(err);
			return;
		}
		const pattern = regexDraft.pattern.trim();
		addRegexRule({
			id: newId("regex"),
			label: regexDraft.label.trim() || pattern,
			pattern,
			replacement: regexDraft.replacement,
			enabled: true,
			caseSensitive: regexDraft.caseSensitive,
		});
		closeRegexForm();
	};

	const submitRegexEdit = () => {
		if (regexFormKey === null || regexFormKey === "add") return;
		const err = validateRegexDraft();
		if (err) {
			setRegexError(err);
			return;
		}
		const pattern = regexDraft.pattern.trim();
		updateRegexRule(regexFormKey, {
			label: regexDraft.label.trim() || pattern,
			pattern,
			replacement: regexDraft.replacement,
			caseSensitive: regexDraft.caseSensitive,
		});
		closeRegexForm();
	};

	const openAddPron = () => {
		closeRegexForm();
		setPronFormKey("add");
		setPronDraft(emptyPronDraft());
		setPronError(null);
	};

	const openEditPron = (rule: PronunciationRule) => {
		if (rule.builtIn) return;
		closeRegexForm();
		setPronFormKey(rule.id);
		setPronDraft({
			word: rule.word,
			phonetic: rule.phonetic,
			caseSensitive: rule.caseSensitive,
		});
		setPronError(null);
	};

	const validatePronDraft = (): string | null => {
		if (!pronDraft.word.trim() || !pronDraft.phonetic.trim()) {
			return "Word and phonetic spelling are required.";
		}
		return null;
	};

	const submitPronAdd = () => {
		const err = validatePronDraft();
		if (err) {
			setPronError(err);
			return;
		}
		addPronunciationRule({
			id: newId("pron"),
			word: pronDraft.word.trim(),
			phonetic: pronDraft.phonetic.trim(),
			caseSensitive: pronDraft.caseSensitive,
			enabled: true,
		});
		closePronForm();
	};

	const submitPronEdit = () => {
		if (pronFormKey === null || pronFormKey === "add") return;
		const err = validatePronDraft();
		if (err) {
			setPronError(err);
			return;
		}
		updatePronunciationRule(pronFormKey, {
			word: pronDraft.word.trim(),
			phonetic: pronDraft.phonetic.trim(),
			caseSensitive: pronDraft.caseSensitive,
		});
		closePronForm();
	};

	const handleExport = async () => {
		setImportError(null);
		setImportNotice(null);
		const result = await exportTtsRulesForUser({
			regexRules,
			pronunciationRules,
		});
		if (!result.ok) {
			if ("cancelled" in result && result.cancelled) return;
			if ("error" in result) setImportError(result.error);
			return;
		}
		if (result.via === "native") {
			setImportNotice(`Saved to ${result.filePath}`);
			return;
		}
		setImportNotice(
			"Download started in your browser (check Downloads if you do not see a prompt).",
		);
	};

	const handleImportClick = () => {
		setImportError(null);
		setImportNotice(null);
		importInputRef.current?.click();
	};

	const handleImportFile = async (file: File | undefined) => {
		if (!file) return;
		setImportError(null);
		setImportNotice(null);
		try {
			const text = await file.text();
			const result = parseTtsRulesExport(text);
			if (!result.ok) {
				setImportError(result.error);
				return;
			}
			const total =
				result.data.regexRules.length + result.data.pronunciationRules.length;
			if (total === 0) {
				setImportError("File contains no custom rules.");
				return;
			}
			const replace = window.confirm(
				`Import ${total} custom rule(s)?\n\nThis replaces your current custom rules. Built-in defaults are kept.`,
			);
			if (!replace) return;
			importUserRules(result.data, "replace");
			closeRegexForm();
			closePronForm();
			setImportNotice(`Imported ${total} custom rule(s).`);
		} catch {
			setImportError("Could not read the file.");
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 space-y-1 border-b border-border px-6 py-4">
				<h2 className="text-base font-semibold leading-none">
					Text &amp; pronunciation rules
				</h2>
				<p className="text-sm text-muted-foreground">
					Clean up chunk text before speech. Highlights still use the original
					text. Pronunciation overrides inject IPA phonemes (English voices
					only; not markdown).
				</p>
				<div className="flex flex-wrap items-center gap-2 pt-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="gap-1.5"
						onClick={handleExport}
					>
						<Download className="size-4" aria-hidden />
						Export…
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="gap-1.5"
						onClick={handleImportClick}
					>
						<Upload className="size-4" aria-hidden />
						Import JSON
					</Button>
					<input
						ref={importInputRef}
						type="file"
						accept=".json,application/json"
						className="sr-only"
						aria-hidden
						tabIndex={-1}
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = "";
							void handleImportFile(file);
						}}
					/>
				</div>
				{importError ? (
					<p className="text-xs text-destructive">{importError}</p>
				) : null}
				{importNotice ? (
					<p className="text-xs text-muted-foreground">{importNotice}</p>
				) : null}
			</div>

			<ScrollArea className="min-h-0 w-full flex-1">
				<div className="px-6 py-4 pr-4">
					<Accordion
						type="multiple"
						defaultValue={["regex", "pronunciation"]}
						className="w-full"
					>
						<RulesAccordionSection
							value="regex"
							title="Text cleanup (regex)"
							ruleCount={regexRules.length}
							isEmpty={regexRules.length === 0}
							emptyMessage="No regex rules yet. Add a rule to clean up text before speech."
							addLabel="Add rule"
							addFormOpen={regexFormKey === "add"}
							onAddClick={() =>
								regexFormKey === "add" ? closeRegexForm() : openAddRegex()
							}
							list={
								<ul className="space-y-1.5">
									{regexRules.map((rule) => (
										<li key={rule.id} className="space-y-1.5">
											<RuleRow
												enabled={rule.enabled}
												onEnabledChange={(v) => setRegexEnabled(rule.id, v)}
												checkboxId={`regex-en-${rule.id}`}
												title={
													<>
														{rule.label}
														{rule.builtIn ? (
															<span className="ml-1.5 text-xs font-normal text-muted-foreground">
																(default)
															</span>
														) : null}
														{rule.caseSensitive ? (
															<span className="ml-1.5 text-xs font-normal text-muted-foreground">
																(case sensitive)
															</span>
														) : null}
													</>
												}
												actions={
													rule.builtIn ? null : (
														<>
															<IconAction
																label={`Edit ${rule.label}`}
																onClick={() => openEditRegex(rule)}
															>
																<Pencil className="size-4" />
															</IconAction>
															<IconAction
																label={`Remove ${rule.label}`}
																destructive
																onClick={() => {
																	if (regexFormKey === rule.id) {
																		closeRegexForm();
																	}
																	removeRegexRule(rule.id);
																}}
															>
																<Trash2 className="size-4" />
															</IconAction>
														</>
													)
												}
											/>
											{regexFormKey === rule.id ? (
												<div ref={inlineEditRef} className="scroll-mt-2">
													<InlineRegexForm
														draft={regexDraft}
														error={regexError}
														submitLabel="Save"
														onDraftChange={(patch) => {
															setRegexDraft((d) => ({ ...d, ...patch }));
															setRegexError(null);
														}}
														onSubmit={submitRegexEdit}
														onCancel={closeRegexForm}
													/>
												</div>
											) : null}
										</li>
									))}
								</ul>
							}
							footer={
								regexFormKey === "add" ? (
									<InlineRegexForm
										draft={regexDraft}
										error={regexError}
										submitLabel="Add rule"
										onDraftChange={(patch) => {
											setRegexDraft((d) => ({ ...d, ...patch }));
											setRegexError(null);
										}}
										onSubmit={submitRegexAdd}
										onCancel={closeRegexForm}
									/>
								) : null
							}
						/>

						<RulesAccordionSection
							value="pronunciation"
							title="Pronunciation fixes"
							ruleCount={pronunciationRules.length}
							isEmpty={pronunciationRules.length === 0}
							emptyMessage="No pronunciation overrides yet. Add a word and IPA spelling for Kokoro."
							addLabel="Add pronunciation"
							addFormOpen={pronFormKey === "add"}
							onAddClick={() =>
								pronFormKey === "add" ? closePronForm() : openAddPron()
							}
							list={
								<ul className="space-y-1.5">
									{pronunciationRules.map((rule) => (
										<li key={rule.id} className="space-y-1.5">
											<RuleRow
												enabled={rule.enabled}
												onEnabledChange={(v) =>
													setPronunciationEnabled(rule.id, v)
												}
												checkboxId={`pron-en-${rule.id}`}
												title={
													<>
														<span>{rule.word}</span>
														<span className="font-normal text-muted-foreground">
															{" "}
															→ {rule.phonetic}
														</span>
														{rule.builtIn ? (
															<span className="ml-1.5 text-xs font-normal text-muted-foreground">
																(default)
															</span>
														) : null}
													</>
												}
												actions={
													rule.builtIn ? null : (
														<>
															<IconAction
																label={`Edit ${rule.word}`}
																onClick={() => openEditPron(rule)}
															>
																<Pencil className="size-4" />
															</IconAction>
															<IconAction
																label={`Remove ${rule.word}`}
																destructive
																onClick={() => {
																	if (pronFormKey === rule.id) {
																		closePronForm();
																	}
																	removePronunciationRule(rule.id);
																}}
															>
																<Trash2 className="size-4" />
															</IconAction>
														</>
													)
												}
											/>
											{pronFormKey === rule.id ? (
												<div ref={inlineEditRef} className="scroll-mt-2">
													<InlinePronForm
														draft={pronDraft}
														error={pronError}
														submitLabel="Save"
														onDraftChange={(patch) => {
															setPronDraft((d) => ({ ...d, ...patch }));
															setPronError(null);
														}}
														onSubmit={submitPronEdit}
														onCancel={closePronForm}
													/>
												</div>
											) : null}
										</li>
									))}
								</ul>
							}
							footer={
								pronFormKey === "add" ? (
									<InlinePronForm
										draft={pronDraft}
										error={pronError}
										submitLabel="Add pronunciation"
										onDraftChange={(patch) => {
											setPronDraft((d) => ({ ...d, ...patch }));
											setPronError(null);
										}}
										onSubmit={submitPronAdd}
										onCancel={closePronForm}
									/>
								) : null
							}
						/>
					</Accordion>
				</div>
			</ScrollArea>
		</div>
	);
}
