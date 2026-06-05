import { Keyboard, RotateCcw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
	SHORTCUT_ACTIONS,
	type ShortcutAction,
	defaultShortcutBindings,
} from "@shared/shortcuts";
import { cn } from "@/lib/utils";
import { useAppSettingsStore } from "./appSettingsStore";

const IS_MAC =
	typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/** Convert a browser keydown to an Electron accelerator, or null if invalid. */
function eventToAccelerator(e: KeyboardEvent): string | null {
	const mods: string[] = [];
	if (e.ctrlKey || e.metaKey) mods.push("CommandOrControl");
	if (e.altKey) mods.push("Alt");
	if (e.shiftKey) mods.push("Shift");

	const c = e.code;
	let key: string | null = null;
	if (c.startsWith("Key")) key = c.slice(3);
	else if (c.startsWith("Digit")) key = c.slice(5);
	else if (c.startsWith("Arrow")) key = c.slice(5);
	else if (c === "Space") key = "Space";
	else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) key = c;

	// Global shortcuts need a modifier plus a real key.
	if (!key || mods.length === 0) return null;
	return [...mods, key].join("+");
}

/** Human-readable accelerator for display. */
function prettyAccelerator(accel: string): string {
	const parts = accel.split("+").map((p) => {
		if (p === "CommandOrControl") return IS_MAC ? "⌘" : "Ctrl";
		if (p === "Shift") return IS_MAC ? "⇧" : "Shift";
		if (p === "Alt") return IS_MAC ? "⌥" : "Alt";
		return p;
	});
	return parts.join(IS_MAC ? " " : "+");
}

function ShortcutRow({
	action,
	label,
	accelerator,
	recording,
	onRecord,
	onReset,
}: {
	action: ShortcutAction;
	label: string;
	accelerator: string;
	recording: boolean;
	onRecord: () => void;
	onReset: () => void;
}) {
	const isDefault = accelerator === defaultShortcutBindings()[action];
	return (
		<div className="flex items-center justify-between gap-3 border-b border-border/50 py-2.5 last:border-b-0">
			<span className="text-sm text-foreground/90">{label}</span>
			<div className="flex items-center gap-1.5">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className={cn(
						"min-w-[8.5rem] justify-center border-border bg-transparent font-mono text-xs",
						recording && "border-primary text-primary",
					)}
					onClick={onRecord}
				>
					{recording ? "Press keys…" : prettyAccelerator(accelerator)}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-8 text-muted-foreground hover:text-foreground disabled:opacity-30"
					aria-label="Reset to default"
					disabled={isDefault}
					onClick={onReset}
				>
					<RotateCcw className="size-4" aria-hidden />
				</Button>
			</div>
		</div>
	);
}

export function ShortcutsPanel() {
	const enabledSwitchId = useId();
	const config = useAppSettingsStore((s) => s.config);
	const setShortcutsEnabled = useAppSettingsStore((s) => s.setShortcutsEnabled);
	const setShortcutBinding = useAppSettingsStore((s) => s.setShortcutBinding);
	const [recording, setRecording] = useState<ShortcutAction | null>(null);

	const enabled = config?.shortcutsEnabled ?? false;
	const bindings = config?.shortcuts ?? defaultShortcutBindings();

	useEffect(() => {
		if (!recording) return;
		const onKeyDown = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.key === "Escape") {
				setRecording(null);
				return;
			}
			const accel = eventToAccelerator(e);
			if (!accel) return; // wait for a modifier + key combo
			void setShortcutBinding(recording, accel);
			setRecording(null);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [recording, setShortcutBinding]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12">
				<h2 className="text-base font-semibold leading-none">Shortcuts</h2>
				<p className="text-sm text-muted-foreground">
					Global media keys that work even when Cross TTS isn't focused.
				</p>
			</div>
			<ScrollArea className="min-h-0 w-full flex-1">
				<div className="px-6 py-5">
				<div className="rounded-lg border border-border bg-muted/20 p-4">
					<label
						htmlFor={enabledSwitchId}
						className="flex cursor-pointer items-center justify-between gap-4"
					>
						<span className="flex items-center gap-2 text-sm font-medium">
							<Keyboard className="size-4 text-muted-foreground" aria-hidden />
							Enable global shortcuts
						</span>
						<Switch
							id={enabledSwitchId}
							checked={enabled}
							onCheckedChange={(v) => void setShortcutsEnabled(v)}
						/>
					</label>
					<p className="mt-3 text-xs text-muted-foreground">
						Off by default. When on, these key combos are captured system-wide
						and may override the same combo in other apps.
					</p>
				</div>

				<div
					className={cn(
						"mt-4 rounded-lg border border-border p-4 transition-opacity",
						!enabled && "pointer-events-none opacity-50",
					)}
				>
					{SHORTCUT_ACTIONS.map(({ id, label }) => (
						<ShortcutRow
							key={id}
							action={id}
							label={label}
							accelerator={bindings[id]}
							recording={recording === id}
							onRecord={() => setRecording((r) => (r === id ? null : id))}
							onReset={() =>
								void setShortcutBinding(id, defaultShortcutBindings()[id])
							}
						/>
					))}
					<p className="mt-3 text-xs text-muted-foreground">
						Click a shortcut, then press the new key combo (must include a
						modifier). Press Esc to cancel.
					</p>
				</div>
				</div>
			</ScrollArea>
		</div>
	);
}
