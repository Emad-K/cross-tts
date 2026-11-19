import { Download, Upload } from "lucide-react";
import { useState } from "react";
import type { BackupPickResult, RestoreMode } from "@shared/backup";
import { showToast } from "@/components/toast/toastStore";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { exportBackup, pickBackup, restoreBackup } from "../backup/backupRestore";

type PickedBackup = Extract<BackupPickResult, { fileName: string }>;

const count = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

function contents(s: PickedBackup["summary"]): string {
	return `${count(s.books, "book")}, ${count(s.bookmarks, "bookmark")} and ${count(s.rules, "custom rule")}`;
}

function madeOn(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? ""
		: `, made on ${date.toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}

/**
 * "Back up…" and "Restore…". Belongs in Settings → General → Storage.
 */
export function BackupRestoreControl() {
	const [busy, setBusy] = useState(false);
	const [picked, setPicked] = useState<PickedBackup | null>(null);

	const failed = (title: string, error: unknown) =>
		showToast({
			title,
			description: error instanceof Error ? error.message : String(error),
			variant: "destructive",
		});

	const run = async (title: string, work: () => Promise<void>) => {
		setBusy(true);
		try {
			await work();
		} catch (e) {
			failed(title, e);
		} finally {
			setBusy(false);
		}
	};

	const onBackUp = () =>
		run("Couldn't save the backup", async () => {
			const result = await exportBackup();
			if (!result) return;
			if ("error" in result) return void failed("Couldn't save the backup", result.error);
			showToast({
				title: "Backup saved",
				description: `${contents(result.summary)}. ${result.filePath}`,
			});
		});

	const onPick = () =>
		run("Couldn't read the backup", async () => {
			const result = await pickBackup();
			if (!result) return;
			if ("error" in result) return void failed("Couldn't read the backup", result.error);
			setPicked(result);
		});

	const onRestore = (mode: RestoreMode) =>
		run("Couldn't restore the backup", async () => {
			if (!picked) return;
			const switchedOff = await restoreBackup(picked.library, mode);
			setPicked(null);
			showToast({
				title: "Backup restored",
				description:
					switchedOff > 0
						? `${count(switchedOff, "custom text rule")} came in switched off. Check ${switchedOff === 1 ? "it" : "them"} in Settings, then turn ${switchedOff === 1 ? "it" : "them"} on.`
						: contents(picked.summary),
				durationMs: switchedOff > 0 ? 12000 : undefined,
			});
		});

	const missing = picked?.missingPaths.length ?? 0;

	return (
		<div className="space-y-2">
			<p className="text-sm font-medium">Backup and restore</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="gap-2 border-border bg-transparent"
					disabled={busy}
					onClick={() => void onBackUp()}
				>
					<Download className="size-4" aria-hidden />
					Back up…
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="gap-2 border-border bg-transparent"
					disabled={busy}
					onClick={() => void onPick()}
				>
					<Upload className="size-4" aria-hidden />
					Restore…
				</Button>
			</div>
			<p className="text-[11px] text-muted-foreground">
				A backup is one file with your library list, reading positions,
				bookmarks, highlights and notes, listening time, each book&apos;s
				voice, text rules and settings. The book files themselves, voice
				models and caches aren&apos;t included.
			</p>

			<Dialog open={picked !== null} onOpenChange={(open) => !open && setPicked(null)}>
				<DialogContent className="max-w-md">
					<DialogTitle>Restore this backup?</DialogTitle>
					{picked ? (
						<>
							<DialogDescription>
								{picked.fileName}
								{madeOn(picked.summary.createdAt)}, has {contents(picked.summary)}.
							</DialogDescription>
							{missing > 0 ? (
								<p className="text-xs text-muted-foreground">
									{missing === 1
										? "1 of its books isn't on this computer. It"
										: `${missing} of its books aren't on this computer. They`}{" "}
									will be listed and marked &ldquo;Missing&rdquo;.
								</p>
							) : null}
							<dl className="space-y-2 text-xs text-muted-foreground">
								<div>
									<dt className="font-medium text-foreground">Merge</dt>
									<dd>
										Keeps everything here and adds what the backup has. For a
										book in both, the more recently read position wins. Your
										settings stay as they are.
									</dd>
								</div>
								<div>
									<dt className="font-medium text-foreground">Replace everything</dt>
									<dd>
										Your library, bookmarks, notes, listening time, text rules
										and settings become what the backup has. What is here now
										is lost.
									</dd>
								</div>
							</dl>
						</>
					) : null}
					<DialogFooter className="gap-2">
						<Button variant="outline" onClick={() => setPicked(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={busy}
							onClick={() => void onRestore("replace")}
						>
							Replace everything
						</Button>
						<Button disabled={busy} onClick={() => void onRestore("merge")}>
							Merge
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
