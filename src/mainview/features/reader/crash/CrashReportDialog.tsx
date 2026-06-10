import { AlertTriangle, ChevronDown, ExternalLink } from "lucide-react";
import { useId, useState } from "react";
import type { CrashRecord } from "@shared/crashReport";
import { crashRecordToJson } from "@shared/crashReport";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveCrashReports } from "@/lib/desktopBridge";
import { cn } from "@/lib/utils";

export type CrashReportDialogProps = {
	records: CrashRecord[];
	/** Called after the user reported or dismissed (the dialog should unmount). */
	onClose: () => void;
};

function kindLabel(kind: CrashRecord["kind"]): string {
	switch (kind) {
		case "render-process-gone":
			return "Window crashed";
		case "child-process-gone":
			return "Helper process crashed";
		case "unhandledRejection":
			return "Unhandled error";
		default:
			return "Crash";
	}
}

/**
 * Non-blocking post-crash dialog (in-app, styled like Settings — not a native
 * dialog). Shows exactly what a GitHub report would contain; nothing is sent
 * unless the user clicks "Report on GitHub", which just opens the browser.
 */
export function CrashReportDialog({ records, onClose }: CrashReportDialogProps) {
	const checkboxId = useId();
	const [showDetails, setShowDetails] = useState(false);
	const [dontAskAgain, setDontAskAgain] = useState(false);
	const [busy, setBusy] = useState(false);
	const latest = records[0];

	const resolve = (action: "report" | "dismiss") => {
		setBusy(true);
		void resolveCrashReports({ action, dontAskAgain }).finally(() => {
			setBusy(false);
			onClose();
		});
	};

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : resolve("dismiss"))}>
			<DialogContent className="max-w-xl gap-0 p-0">
				<DialogHeader className="space-y-2 px-6 pb-4 pt-6">
					<DialogTitle className="flex items-center gap-2 text-base">
						<AlertTriangle className="size-5 shrink-0 text-amber-400" aria-hidden />
						Cross TTS crashed last time
					</DialogTitle>
					<DialogDescription className="text-sm leading-relaxed text-muted-foreground">
						{records.length === 1
							? "A crash was recorded during your last session."
							: `${records.length} crashes were recorded during recent sessions.`}{" "}
						You can report it on GitHub to help fix it — nothing is ever sent
						automatically, and the report contains only the technical details
						below (no document text or personal data).
					</DialogDescription>
				</DialogHeader>

				<div className="px-6">
					{latest ? (
						<div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
							<span className="font-medium text-foreground">
								{kindLabel(latest.kind)}:
							</span>{" "}
							<span className="break-all font-mono">
								{latest.name}: {latest.message || "(no message)"}
							</span>
						</div>
					) : null}

					<button
						type="button"
						className="mt-3 flex w-full items-center gap-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
						aria-expanded={showDetails}
						onClick={() => setShowDetails((v) => !v)}
					>
						<ChevronDown
							className={cn(
								"size-3.5 shrink-0 transition-transform",
								!showDetails && "-rotate-90",
							)}
							aria-hidden
						/>
						{showDetails ? "Hide report contents" : "Show exactly what would be reported"}
					</button>

					{showDetails ? (
						<ScrollArea className="mt-2 h-48 w-full rounded-md border border-border bg-muted/20">
							<pre className="whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
								{records.map((r) => crashRecordToJson(r)).join("\n\n")}
							</pre>
						</ScrollArea>
					) : null}

					<label
						htmlFor={checkboxId}
						className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
					>
						<Checkbox
							id={checkboxId}
							checked={dontAskAgain}
							onCheckedChange={(v) => setDontAskAgain(v === true)}
						/>
						Don't ask again after crashes
					</label>
				</div>

				<DialogFooter className="gap-2 px-6 pb-6 pt-4">
					<Button
						type="button"
						variant="ghost"
						disabled={busy}
						onClick={() => resolve("dismiss")}
					>
						Dismiss
					</Button>
					<Button type="button" disabled={busy} onClick={() => resolve("report")}>
						<ExternalLink className="size-4" aria-hidden />
						Report on GitHub
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export default CrashReportDialog;
