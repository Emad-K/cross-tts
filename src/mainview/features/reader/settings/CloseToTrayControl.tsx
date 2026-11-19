import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { useAppSettingsStore } from "./appSettingsStore";

/**
 * "Keep playing when the window is closed": closing hides the window to the
 * tray instead of quitting. Belongs in Settings → General, in its own
 * "Background playback" group.
 */
export function CloseToTrayControl() {
	const switchId = useId();
	const hintId = useId();
	const config = useAppSettingsStore((s) => s.config);
	if (!config) return null;

	const onToggle = async (enabled: boolean) => {
		const updated = await window.api?.request.setKeepPlayingInBackground({
			enabled,
		});
		if (updated) useAppSettingsStore.getState().setConfig(updated);
	};

	return (
		<div className="rounded-lg border border-border bg-muted/20 p-4">
			<label
				htmlFor={switchId}
				className="flex cursor-pointer items-center justify-between gap-4"
			>
				<span className="text-sm font-medium">
					Keep playing when the window is closed
				</span>
				<Switch
					id={switchId}
					aria-describedby={hintId}
					checked={config.keepPlayingInBackground && config.trayAvailable}
					disabled={!config.trayAvailable}
					onCheckedChange={(v) => void onToggle(v)}
				/>
			</label>
			<p id={hintId} className="mt-3 text-xs text-muted-foreground">
				{config.trayAvailable
					? "Closing the window hides it and the book keeps playing. A Cross TTS icon in the system tray (the menu bar on a Mac) has Play, Next, Previous, Show window and Quit."
					: "Not available here: this desktop doesn't show tray icons, so there would be no way to bring the window back. Closing the window quits the app. On GNOME, the AppIndicator extension adds tray icons."}
			</p>
		</div>
	);
}
