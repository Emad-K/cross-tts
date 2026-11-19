import { BookOpen, ClipboardPaste, FolderOpen, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isExportPhaseActive, useExportStore } from "../audiobook/exportStore";
import { useAppSettingsStore } from "../settings/appSettingsStore";
import { EngineCards, useModelFiles, VoiceControl } from "../settings/VoicePanel";
import { playSample, stopPlaybackUi, useTtsStore } from "../tts";
import { canLoadWithoutDownload } from "../tts/modelOnDisk";
import { closeWelcome } from "./welcomeStore";

const SAMPLE_SENTENCE =
	"Hello. This is how I sound when I read your books to you.";

const STEPS = ["Welcome to Cross TTS", "Choose a voice", "Start listening"] as const;

/** Step 2: the Voice tab's engine cards and voice picker, plus a sample. */
function VoiceStep() {
	const files = useModelFiles();
	const engineId = useTtsStore((s) => s.engineId);
	const config = useAppSettingsStore((s) => s.config);
	const exporting = useExportStore((s) => isExportPhaseActive(s.phase));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// The sample loads the model, and loading a model that isn't on disk
	// downloads it: only the Download button may do that.
	const ready = canLoadWithoutDownload(
		engineId,
		config?.ttsBackend ?? "auto",
		config?.backends.native ?? false,
		files.disk,
	);
	// Leaving the step (or the welcome) cuts the sample short.
	useEffect(() => () => stopPlaybackUi(), []);

	const onSample = async () => {
		setBusy(true);
		setError(null);
		try {
			await playSample(SAMPLE_SENTENCE);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<EngineCards files={files} />
			<VoiceControl />
			<div className="mt-3 flex flex-wrap items-center gap-3">
				<Button
					type="button"
					variant="outline"
					className="gap-2"
					disabled={!ready || busy || exporting}
					onClick={() => void onSample()}
				>
					<Volume2 className="size-4" aria-hidden />
					{busy ? "Playing…" : "Hear a sample"}
				</Button>
				<p className="text-xs text-muted-foreground" role="status">
					{error ??
						(ready
							? "Plays one sentence in the chosen voice."
							: "Download the selected engine above to hear it. Nothing downloads until you ask.")}
				</p>
			</div>
		</>
	);
}

/**
 * First-run welcome: what the app does, pick an engine and voice, open
 * something to listen to. Every step can be skipped; closing it any way
 * (Skip, Escape, the X) just leaves the app as it is.
 */
export function WelcomeDialog({
	onOpenFile,
	onPasteText,
	onLoadSample,
}: {
	onOpenFile: () => void;
	onPasteText: () => void;
	onLoadSample: () => void;
}) {
	const [step, setStep] = useState(0);
	const last = step === STEPS.length - 1;
	const nextRef = useRef<HTMLButtonElement>(null);
	const finish = (action: () => void) => () => {
		closeWelcome();
		action();
	};

	return (
		<Dialog open onOpenChange={(open) => !open && closeWelcome()}>
			<DialogContent
				className="flex max-h-[min(90vh,44rem)] w-full max-w-2xl flex-col gap-0 p-0"
				// Enter moves on; the first button in the dialog is Skip.
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					nextRef.current?.focus();
				}}
			>
				<div className="shrink-0 space-y-1.5 border-b border-border px-6 py-4 pr-12">
					<p className="text-xs text-muted-foreground" aria-live="polite">
						Step {step + 1} of {STEPS.length}
					</p>
					<DialogTitle>{STEPS[step]}</DialogTitle>
					<DialogDescription>
						{step === 0
							? "Cross TTS reads your books and documents aloud in a natural voice."
							: step === 1
								? "Pick who reads to you. You can change this at any time in Settings."
								: "Choose something to listen to."}
					</DialogDescription>
				</div>
				<ScrollArea className="min-h-0 flex-1">
					<div className="px-6 py-5">
						{step === 0 ? (
							<ul className="list-disc space-y-2 pl-5 text-sm">
								<li>Opens EPUB, PDF, Word, text, Markdown and HTML files.</li>
								<li>
									Highlights each sentence as it is read, and remembers your
									place in every book.
								</li>
								<li>
									Works offline. The voice runs on this computer, and your books
									never leave it.
								</li>
								<li>
									The voice is a one-time download. It starts only when you ask
									for it.
								</li>
							</ul>
						) : step === 1 ? (
							<VoiceStep />
						) : (
							<div className="flex flex-col gap-3">
								<Button
									type="button"
									size="lg"
									className="justify-start gap-2"
									// Next, which had the focus, is gone on this step.
									autoFocus
									onClick={finish(onOpenFile)}
								>
									<FolderOpen className="size-4" aria-hidden />
									Open a book
								</Button>
								<Button
									type="button"
									size="lg"
									variant="outline"
									className="justify-start gap-2"
									onClick={finish(onPasteText)}
								>
									<ClipboardPaste className="size-4" aria-hidden />
									Paste text from the clipboard
								</Button>
								<Button
									type="button"
									size="lg"
									variant="outline"
									className="justify-start gap-2"
									onClick={finish(onLoadSample)}
								>
									<BookOpen className="size-4" aria-hidden />
									Try the sample book
								</Button>
							</div>
						)}
					</div>
				</ScrollArea>
				<div className="flex shrink-0 items-center gap-2 border-t border-border px-6 py-3">
					<Button type="button" variant="ghost" onClick={closeWelcome}>
						Skip for now
					</Button>
					<span className="flex-1" />
					{step > 0 ? (
						<Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
							Back
						</Button>
					) : null}
					{last ? null : (
						<Button ref={nextRef} type="button" onClick={() => setStep(step + 1)}>
							Next
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
