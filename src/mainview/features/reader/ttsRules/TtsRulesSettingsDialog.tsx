import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { isValidRegexPattern } from "@shared/ttsTextRules";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTtsRulesStore } from "./ttsRulesStore";

export type TtsRulesSettingsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

function newId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

export function TtsRulesSettingsDialog({
	open,
	onOpenChange,
}: TtsRulesSettingsDialogProps) {
	const regexRules = useTtsRulesStore((s) => s.regexRules);
	const pronunciationRules = useTtsRulesStore((s) => s.pronunciationRules);
	const setRegexEnabled = useTtsRulesStore((s) => s.setRegexEnabled);
	const updateRegexRule = useTtsRulesStore((s) => s.updateRegexRule);
	const addRegexRule = useTtsRulesStore((s) => s.addRegexRule);
	const removeRegexRule = useTtsRulesStore((s) => s.removeRegexRule);
	const setPronunciationEnabled = useTtsRulesStore(
		(s) => s.setPronunciationEnabled,
	);
	const addPronunciationRule = useTtsRulesStore((s) => s.addPronunciationRule);
	const removePronunciationRule = useTtsRulesStore(
		(s) => s.removePronunciationRule,
	);

	const [regexLabel, setRegexLabel] = useState("");
	const [regexPattern, setRegexPattern] = useState("");
	const [regexReplacement, setRegexReplacement] = useState("");
	const [regexError, setRegexError] = useState<string | null>(null);

	const [pronWord, setPronWord] = useState("");
	const [pronPhonetic, setPronPhonetic] = useState("");
	const [pronCaseSensitive, setPronCaseSensitive] = useState(false);
	const [pronError, setPronError] = useState<string | null>(null);

	const submitRegex = () => {
		const pattern = regexPattern.trim();
		if (!pattern) {
			setRegexError("Enter a regex pattern.");
			return;
		}
		if (!isValidRegexPattern(pattern)) {
			setRegexError("Invalid regular expression.");
			return;
		}
		addRegexRule({
			id: newId("regex"),
			label: regexLabel.trim() || pattern,
			pattern,
			replacement: regexReplacement,
			enabled: true,
		});
		setRegexLabel("");
		setRegexPattern("");
		setRegexReplacement("");
		setRegexError(null);
	};

	const submitPronunciation = () => {
		const word = pronWord.trim();
		const phonetic = pronPhonetic.trim();
		if (!word || !phonetic) {
			setPronError("Word and phonetic spelling are required.");
			return;
		}
		addPronunciationRule({
			id: newId("pron"),
			word,
			phonetic,
			caseSensitive: pronCaseSensitive,
			enabled: true,
		});
		setPronWord("");
		setPronPhonetic("");
		setPronCaseSensitive(false);
		setPronError(null);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="dark flex h-[min(90vh,40rem)] max-h-[min(90vh,40rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg [&>button]:z-10">
				<DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12">
					<DialogTitle>TTS text rules</DialogTitle>
					<DialogDescription>
						Clean up chunk text before speech. Highlights still use the
						original text. Pronunciation overrides inject IPA phonemes
						(English voices only; not markdown).
					</DialogDescription>
				</DialogHeader>

				<ScrollArea className="min-h-0 w-full flex-1">
					<div className="space-y-8 px-6 py-4 pr-4">
						<section className="space-y-3">
							<h3 className="text-sm font-medium text-foreground">
								Text cleanup (regex)
							</h3>
							<ul className="space-y-3">
								{regexRules.map((rule) => (
									<li
										key={rule.id}
										className={cn(
											"rounded-lg border border-border p-3",
											!rule.enabled && "opacity-60",
										)}
									>
										<div className="flex items-start gap-3">
											<Checkbox
												id={`regex-en-${rule.id}`}
												checked={rule.enabled}
												onCheckedChange={(v) =>
													setRegexEnabled(rule.id, v === true)
												}
												className="mt-0.5"
											/>
											<div className="min-w-0 flex-1 space-y-2">
												<Label
													htmlFor={`regex-en-${rule.id}`}
													className="cursor-pointer font-medium leading-snug"
												>
													{rule.label}
													{rule.builtIn ? (
														<span className="ml-1.5 text-xs font-normal text-muted-foreground">
															(default)
														</span>
													) : null}
												</Label>
												<div className="grid gap-2 sm:grid-cols-2">
													<div className="space-y-1">
														<span className="text-xs text-muted-foreground">
															Pattern
														</span>
														<Input
															value={rule.pattern}
															onChange={(e) =>
																updateRegexRule(rule.id, {
																	pattern: e.target.value,
																})
															}
															className="h-8 font-mono text-xs"
															spellCheck={false}
														/>
													</div>
													<div className="space-y-1">
														<span className="text-xs text-muted-foreground">
															Replace with
														</span>
														<Input
															value={rule.replacement}
															placeholder="(empty removes)"
															onChange={(e) =>
																updateRegexRule(rule.id, {
																	replacement: e.target.value,
																})
															}
															className="h-8 font-mono text-xs"
															spellCheck={false}
														/>
													</div>
												</div>
											</div>
											{!rule.builtIn ? (
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="shrink-0 text-muted-foreground hover:text-destructive"
													aria-label="Remove rule"
													onClick={() => removeRegexRule(rule.id)}
												>
													<Trash2 className="size-4" />
												</Button>
											) : null}
										</div>
									</li>
								))}
							</ul>

							<div className="rounded-lg border border-dashed border-border p-3 space-y-3">
								<p className="text-xs font-medium text-muted-foreground">
									Add regex rule
								</p>
								<div className="space-y-2">
									<Input
										placeholder="Label (optional)"
										value={regexLabel}
										onChange={(e) => setRegexLabel(e.target.value)}
									/>
									<Input
										placeholder="Regex pattern"
										value={regexPattern}
										onChange={(e) => {
											setRegexPattern(e.target.value);
											setRegexError(null);
										}}
										className="font-mono text-sm"
										spellCheck={false}
									/>
									<Input
										placeholder="Replacement (leave empty to remove)"
										value={regexReplacement}
										onChange={(e) =>
											setRegexReplacement(e.target.value)
										}
										className="font-mono text-sm"
										spellCheck={false}
									/>
									{regexError ? (
										<p className="text-xs text-destructive">{regexError}</p>
									) : null}
									<Button
										type="button"
										size="sm"
										className="gap-1.5"
										onClick={submitRegex}
									>
										<Plus className="size-4" />
										Add rule
									</Button>
								</div>
							</div>
						</section>

						<section className="space-y-3">
							<h3 className="text-sm font-medium text-foreground">
								Pronunciation fixes
							</h3>
							{pronunciationRules.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									No pronunciation overrides yet.
								</p>
							) : (
								<ul className="space-y-3">
									{pronunciationRules.map((rule) => (
										<li
											key={rule.id}
											className={cn(
												"flex items-center gap-3 rounded-lg border border-border p-3",
												!rule.enabled && "opacity-60",
											)}
										>
											<Checkbox
												id={`pron-en-${rule.id}`}
												checked={rule.enabled}
												onCheckedChange={(v) =>
													setPronunciationEnabled(
														rule.id,
														v === true,
													)
												}
											/>
											<Label
												htmlFor={`pron-en-${rule.id}`}
												className="min-w-0 flex-1 cursor-pointer text-sm leading-snug"
											>
												<span className="font-medium">{rule.word}</span>
												<span className="text-muted-foreground">
													{" "}
													→ IPA: {rule.phonetic}
												</span>
												{rule.caseSensitive ? (
													<span className="ml-1 text-xs text-muted-foreground">
														(case sensitive)
													</span>
												) : null}
											</Label>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="shrink-0 text-muted-foreground hover:text-destructive"
												aria-label="Remove pronunciation"
												onClick={() =>
													removePronunciationRule(rule.id)
												}
											>
												<Trash2 className="size-4" />
											</Button>
										</li>
									))}
								</ul>
							)}

							<div className="rounded-lg border border-dashed border-border p-3 space-y-3">
								<p className="text-xs font-medium text-muted-foreground">
									Add pronunciation
								</p>
								<div className="grid gap-2 sm:grid-cols-2">
									<div className="space-y-1">
										<Label htmlFor="pron-word">Word</Label>
										<Input
											id="pron-word"
											placeholder="Los Angeles"
											value={pronWord}
											onChange={(e) => {
												setPronWord(e.target.value);
												setPronError(null);
											}}
										/>
									</div>
									<div className="space-y-1">
										<Label htmlFor="pron-ipa">Phonetic (IPA)</Label>
										<Input
											id="pron-ipa"
											placeholder="lɔs ˈænd͡ʒɛləs"
											value={pronPhonetic}
											onChange={(e) => {
												setPronPhonetic(e.target.value);
												setPronError(null);
											}}
											className="font-mono text-sm"
										/>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<Checkbox
										id="pron-case"
										checked={pronCaseSensitive}
										onCheckedChange={(v) =>
											setPronCaseSensitive(v === true)
										}
									/>
									<Label htmlFor="pron-case" className="cursor-pointer">
										Case sensitive
									</Label>
								</div>
								{pronError ? (
									<p className="text-xs text-destructive">{pronError}</p>
								) : null}
								<Button
									type="button"
									size="sm"
									className="gap-1.5"
									onClick={submitPronunciation}
								>
									<Plus className="size-4" />
									Add pronunciation
								</Button>
							</div>
						</section>
					</div>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}
