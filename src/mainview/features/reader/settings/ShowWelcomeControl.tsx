import { Button } from "@/components/ui/button";
import { openWelcome } from "../welcome/welcomeStore";

/**
 * "Show welcome again": reopens the first-run welcome (Settings closes to
 * make room for it). Belongs in Settings → General, in its own "Welcome" group.
 */
export function ShowWelcomeControl() {
	return (
		<div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 p-4">
			<p className="text-xs text-muted-foreground">
				The short introduction from the first time you opened Cross TTS.
			</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="shrink-0 border-border bg-transparent"
				onClick={openWelcome}
			>
				Show welcome again
			</Button>
		</div>
	);
}
