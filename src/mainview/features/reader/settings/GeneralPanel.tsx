import { Download, FolderOpen, FolderPlus, Loader2, RotateCcw, X } from "lucide-react";
import { useId, useState } from "react";
import { SUPPORTED_DOCUMENT_LABEL } from "@shared/droppedFiles";
import type { UpdateStatus } from "@shared/updateStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
	addWatchedFolder,
	checkForUpdates,
	chooseDataDirectory,
	isDesktopApp,
	quitAndInstallUpdate,
	relaunchApp,
	removeWatchedFolder,
	resetDataDirectory,
	revealDataDirectory,
	setCrashPromptDisabled,
} from "@/lib/desktopBridge";
import { cn } from "@/lib/utils";
import { useAppSettingsStore } from "./appSettingsStore";
import { BackupRestoreControl } from "./BackupRestoreControl";
import { CloseToTrayControl } from "./CloseToTrayControl";
import { SectionPane, SettingsGroup } from "./SectionPane";
import { ShowWelcomeControl } from "./ShowWelcomeControl";
import { useUpdateStore } from "./updateStore";

const BOX = "rounded-lg border border-border bg-muted/20 p-4";

function WatchedFolders() {
	const config = useAppSettingsStore((s) => s.config);
	const [working, setWorking] = useState(false);
	const folders = config?.watchedFolders ?? [];

	const onAdd = async () => {
		setWorking(true);
		try {
			const updated = await addWatchedFolder();
			if (updated) useAppSettingsStore.getState().setConfig(updated);
		} finally {
			setWorking(false);
		}
	};

	const onRemove = async (dir: string) => {
		const updated = await removeWatchedFolder(dir);
		if (updated) useAppSettingsStore.getState().setConfig(updated);
	};

	return (
		<div className="space-y-2">
			<p className="text-sm font-medium">Watched folders</p>
			{folders.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					No folders are being watched.
				</p>
			) : (
				<ul className="space-y-1.5">
					{folders.map((dir) => (
						<li
							key={dir}
							className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5"
						>
							<FolderOpen
								className="size-4 shrink-0 text-muted-foreground"
								aria-hidden
							/>
							<span
								className="min-w-0 flex-1 break-all font-mono text-xs text-foreground/90"
								title={dir}
							>
								{dir}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
								aria-label={`Stop watching ${dir}`}
								onClick={() => void onRemove(dir)}
							>
								<X className="size-4" aria-hidden />
							</Button>
						</li>
					))}
				</ul>
			)}
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="gap-2 border-border bg-transparent"
				disabled={working}
				onClick={() => void onAdd()}
			>
				<FolderPlus className="size-4" aria-hidden />
				Add folder…
			</Button>
			<p className="text-[11px] text-muted-foreground">
				New {SUPPORTED_DOCUMENT_LABEL} in these folders (and their direct
				subfolders) are added to your library automatically.
			</p>
		</div>
	);
}

function updateStatusLabel(status: UpdateStatus): string | null {
	switch (status.state) {
		case "checking":
			return "Checking for updates…";
		case "downloading":
			return status.version
				? `Downloading ${status.version}…`
				: "Downloading update…";
		case "ready":
			return status.version
				? `${status.version} is ready — restart to update.`
				: "An update is ready — restart to update.";
		case "up-to-date":
			return "You're on the latest version.";
		case "error":
			return status.error ?? "Update check failed.";
		default:
			return null;
	}
}

function Updates() {
	const switchId = useId();
	const config = useAppSettingsStore((s) => s.config);
	const setAutoUpdate = useAppSettingsStore((s) => s.setAutoUpdate);
	const status = useUpdateStore((s) => s.status);
	// `null` = not chosen yet; treat as off until the user opts in.
	const enabled = config?.autoUpdate === true;
	const busy = status.state === "checking" || status.state === "downloading";
	const statusLabel = updateStatusLabel(status);

	return (
		<>
			<div className={BOX}>
				<label
					htmlFor={switchId}
					className="flex cursor-pointer items-center justify-between gap-4"
				>
					<span className="text-sm font-medium">Automatic updates</span>
					<Switch
						id={switchId}
						checked={enabled}
						onCheckedChange={(v) => void setAutoUpdate(v)}
					/>
				</label>
				<p className="mt-3 text-xs text-muted-foreground">
					When on, new versions download in the background and install the next
					time you restart. When off, Cross TTS never checks for updates — grab
					new releases yourself from GitHub, or use the button below.
				</p>
			</div>
			{isDesktopApp() ? (
				<div className={cn(BOX, "flex flex-wrap items-center gap-3")}>
					{status.state === "ready" ? (
						<Button
							type="button"
							size="sm"
							onClick={() => void quitAndInstallUpdate()}
						>
							<RotateCcw className="mr-2 size-4" aria-hidden />
							Restart to update
						</Button>
					) : (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => void checkForUpdates()}
						>
							{busy ? (
								<Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
							) : (
								<Download className="mr-2 size-4" aria-hidden />
							)}
							Check for updates
						</Button>
					)}
					{statusLabel ? (
						<p
							className={cn(
								"text-xs",
								status.state === "error"
									? "text-destructive"
									: "text-muted-foreground",
							)}
							aria-live="polite"
						>
							{statusLabel}
						</p>
					) : null}
				</div>
			) : null}
			<p className="text-[11px] text-muted-foreground">
				Updates only apply to the installed desktop app.
			</p>
		</>
	);
}

function DataFolder() {
	const config = useAppSettingsStore((s) => s.config);
	const [pendingRestart, setPendingRestart] = useState(false);
	const [working, setWorking] = useState(false);

	const move = async (pick: typeof chooseDataDirectory) => {
		setWorking(true);
		try {
			const updated = await pick();
			if (updated) {
				useAppSettingsStore.getState().setConfig(updated);
				setPendingRestart(true);
			}
		} finally {
			setWorking(false);
		}
	};

	return (
		<>
			<div className="rounded-md border border-border bg-background px-3 py-2">
				<div className="flex items-center justify-between gap-2">
					<span className="text-sm font-medium">Data folder</span>
					{config?.isDefaultDataDir ? (
						<Badge
							variant="secondary"
							className="rounded-sm border border-border bg-muted px-1.5 py-0 text-[10px] font-normal"
						>
							Default
						</Badge>
					) : null}
				</div>
				<p
					className="mt-1 break-all font-mono text-xs text-foreground/90"
					title={config?.dataDir ?? ""}
				>
					{config?.dataDir ?? "—"}
				</p>
			</div>
			<p className="text-[11px] text-muted-foreground">
				Where voice models, your library, notes and listening time are saved
				on this device.
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="gap-2 border-border bg-transparent"
					disabled={working}
					onClick={() => void move(chooseDataDirectory)}
				>
					<FolderOpen className="size-4" aria-hidden />
					Change…
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="gap-2 text-muted-foreground hover:text-foreground"
					onClick={() => void revealDataDirectory()}
				>
					Reveal in file manager
				</Button>
				{config && !config.isDefaultDataDir ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="gap-2 text-muted-foreground hover:text-foreground"
						disabled={working}
						onClick={() => void move(resetDataDirectory)}
					>
						<RotateCcw className="size-4" aria-hidden />
						Use default
					</Button>
				) : null}
			</div>
			{pendingRestart ? (
				<div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
					<p className="text-xs text-amber-300">
						Restart to use the new folder. Existing models stay where they are.
					</p>
					<Button
						type="button"
						size="sm"
						className="shrink-0"
						onClick={() => void relaunchApp()}
					>
						Restart now
					</Button>
				</div>
			) : null}
		</>
	);
}

function CrashReports() {
	const switchId = useId();
	const config = useAppSettingsStore((s) => s.config);
	if (!config) return null;
	const onToggle = async (ask: boolean) => {
		const updated = await setCrashPromptDisabled(!ask);
		if (updated) useAppSettingsStore.getState().setConfig(updated);
	};
	return (
		<div className={BOX}>
			<label
				htmlFor={switchId}
				className="flex cursor-pointer items-center justify-between gap-4"
			>
				<span className="text-sm font-medium">
					Ask to send a report after a crash
				</span>
				<Switch
					id={switchId}
					checked={!config.crashPromptDisabled}
					onCheckedChange={(v) => void onToggle(v)}
				/>
			</label>
			<p className="mt-3 text-xs text-muted-foreground">
				After a crash, the next launch offers to report it on GitHub. Nothing
				is ever sent automatically.
			</p>
		</div>
	);
}

export function GeneralPanel() {
	return (
		<SectionPane
			title="General"
			description="Background playback, your library folders, updates, storage and crash reports."
		>
			<SettingsGroup title="Background playback">
				<CloseToTrayControl />
			</SettingsGroup>
			<SettingsGroup title="Library">
				<WatchedFolders />
			</SettingsGroup>
			<SettingsGroup title="Updates">
				<Updates />
			</SettingsGroup>
			<SettingsGroup title="Storage">
				<DataFolder />
				<BackupRestoreControl />
			</SettingsGroup>
			<SettingsGroup title="Crash reports">
				<CrashReports />
			</SettingsGroup>
			<SettingsGroup title="Welcome">
				<ShowWelcomeControl />
			</SettingsGroup>
		</SectionPane>
	);
}
