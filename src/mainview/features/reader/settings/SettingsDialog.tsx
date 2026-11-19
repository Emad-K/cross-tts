import { AudioLines, Keyboard, Palette, SlidersHorizontal, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AppearancePanel } from "./AppearancePanel";
import { useAppSettingsStore } from "./appSettingsStore";
import { GeneralPanel } from "./GeneralPanel";
import type { SettingsSectionId } from "./SectionPane";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { TtsRulesPanel } from "./TtsRulesPanel";
import { VoicePanel } from "./VoicePanel";

const NAV: { id: SettingsSectionId; label: string; icon: typeof Palette }[] = [
	{ id: "voice", label: "Voice", icon: AudioLines },
	{ id: "appearance", label: "Appearance", icon: Palette },
	{ id: "rules", label: "Pronunciation", icon: Wand2 },
	{ id: "shortcuts", label: "Shortcuts", icon: Keyboard },
	{ id: "general", label: "General", icon: SlidersHorizontal },
];

export type SettingsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The tab to open on. */
	initialSection?: SettingsSectionId;
};

export function SettingsDialog({
	open,
	onOpenChange,
	initialSection = "voice",
}: SettingsDialogProps) {
	const [section, setSection] = useState(initialSection);
	const hydrate = useAppSettingsStore((s) => s.hydrate);
	const refresh = useAppSettingsStore((s) => s.refresh);
	const appVersion = useAppSettingsStore((s) => s.config?.appVersion);

	useEffect(() => {
		if (!open) return;
		void hydrate();
		void refresh();
	}, [open, hydrate, refresh]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				aria-describedby={undefined}
				className="flex h-[min(90vh,40rem)] max-h-[min(90vh,40rem)] w-full max-w-3xl gap-0 overflow-hidden p-0 [&>button]:z-10"
			>
				<DialogTitle className="sr-only">Settings</DialogTitle>
				{/* Left nav (Claude-desktop style). */}
				<nav className="flex w-48 shrink-0 flex-col border-r border-border bg-muted/20 p-3">
					<p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Settings
					</p>
					<ul className="flex flex-col gap-0.5">
						{NAV.map((item) => {
							const Icon = item.icon;
							const activeItem = section === item.id;
							return (
								<li key={item.id}>
									<button
										type="button"
										onClick={() => setSection(item.id)}
										aria-current={activeItem ? "page" : undefined}
										className={cn(
											"flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
											activeItem
												? "bg-muted font-medium text-foreground"
												: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
										)}
									>
										<Icon className="size-4 shrink-0" aria-hidden />
										{item.label}
									</button>
								</li>
							);
						})}
					</ul>
					<p className="mt-auto px-2 pt-3 text-[11px] text-muted-foreground">
						Cross TTS{appVersion ? ` v${appVersion}` : ""}
					</p>
				</nav>

				{/* Right content pane. */}
				<div className="min-h-0 min-w-0 flex-1">
					{section === "voice" ? <VoicePanel /> : null}
					{section === "appearance" ? <AppearancePanel /> : null}
					{section === "rules" ? <TtsRulesPanel active /> : null}
					{section === "shortcuts" ? <ShortcutsPanel /> : null}
					{section === "general" ? <GeneralPanel /> : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
