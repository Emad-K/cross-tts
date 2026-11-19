import { useState } from "react";
import { showToast } from "@/components/toast/toastStore";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RuleScopeSelect } from "../settings/RuleScopeSelect";
import { respellRule } from "./respellRule";
import { useTtsRulesStore } from "./ttsRulesStore";

/**
 * "Fix pronunciation…" from the reader's right-click menu: one word, how to
 * say it, and whether that holds for every book or just this one.
 */
export function FixPronunciationDialog({
	word: initialWord,
	onClose,
}: {
	word: string;
	onClose: () => void;
}) {
	const [word, setWord] = useState(initialWord);
	const [sayAs, setSayAs] = useState("");
	const [ipa, setIpa] = useState(false);
	// All books by default: a name is said the same way across a series, and
	// that is how rules worked before scopes existed.
	const [book, setBook] = useState<string | undefined>(undefined);
	const ready = word.trim().length > 0 && sayAs.trim().length > 0;

	const save = () => {
		if (!ready) return;
		const store = useTtsRulesStore.getState();
		const w = word.trim();
		const s = sayAs.trim();
		if (ipa) {
			store.addPronunciationRule({
				id: `pron-${crypto.randomUUID()}`,
				word: w,
				phonetic: s,
				caseSensitive: false,
				enabled: true,
				book,
			});
		} else {
			store.addRegexRule({
				id: `regex-${crypto.randomUUID()}`,
				...respellRule(w, s),
				book,
			});
		}
		showToast({
			title: `Pronunciation of “${w}” saved`,
			description: "Change or remove it in Settings, under pronunciation rules.",
		});
		onClose();
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Fix pronunciation</DialogTitle>
					<DialogDescription>
						Tell the voice how to say a word. The text on screen doesn't
						change.
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						save();
					}}
				>
					<div className="space-y-1">
						<Label htmlFor="fix-pron-word">Word</Label>
						<Input
							id="fix-pron-word"
							value={word}
							onChange={(e) => setWord(e.target.value)}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="fix-pron-say">
							{ipa ? "IPA phonemes" : "Say it as"}
						</Label>
						<Input
							id="fix-pron-say"
							autoFocus
							value={sayAs}
							onChange={(e) => setSayAs(e.target.value)}
							placeholder={ipa ? "ʃɪˈvɔːn" : "shiv-awn"}
							spellCheck={false}
						/>
						<p className="text-xs text-muted-foreground">
							{ipa
								? "Exact phonemes. Works with Kokoro's English voices only."
								: "Spell it the way it sounds. Works with every voice."}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<input
							id="fix-pron-ipa"
							type="checkbox"
							checked={ipa}
							onChange={(e) => setIpa(e.target.checked)}
							className="size-4 accent-primary"
						/>
						<Label htmlFor="fix-pron-ipa" className="cursor-pointer font-normal">
							Use IPA phonemes instead
						</Label>
					</div>
					<RuleScopeSelect id="fix-pron-scope" value={book} onChange={setBook} />
					<DialogFooter className="gap-2 sm:space-x-0">
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={!ready}>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
