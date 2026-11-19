import { useId } from "react";
import { type HighlightMode, defaultAppearance } from "@shared/appearance";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAppSettingsStore } from "./appSettingsStore";

/**
 * "Highlight: Sentence / Word" setting. Self-contained (reads and saves the
 * appearance setting itself); belongs in Settings > Appearance.
 */
export function HighlightModeControl() {
	const labelId = useId();
	const hintId = useId();
	const mode = useAppSettingsStore(
		(s) => (s.config?.appearance ?? defaultAppearance()).highlightMode,
	);
	const setAppearance = useAppSettingsStore((s) => s.setAppearance);
	return (
		<div className="rounded-lg border border-border bg-muted/20 p-4">
			<div id={labelId} className="mb-3 text-sm font-medium">
				Highlight
			</div>
			<Select
				value={mode}
				onValueChange={(v) =>
					void setAppearance({ highlightMode: v as HighlightMode })
				}
			>
				<SelectTrigger
					className="w-full"
					aria-labelledby={labelId}
					aria-describedby={hintId}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="sentence">Sentence</SelectItem>
					<SelectItem value="word">Word</SelectItem>
				</SelectContent>
			</Select>
			<p id={hintId} className="mt-2 text-xs text-muted-foreground">
				Word also marks the word being spoken inside the sentence. Its timing
				is estimated, so it can run slightly ahead or behind the voice.
			</p>
		</div>
	);
}
