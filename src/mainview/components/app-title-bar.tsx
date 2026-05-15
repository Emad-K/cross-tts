import { useEffect, useState } from "react";
import { Maximize2, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	bootElectrobunMainView,
	isElectrobunWebview,
	requestCloseWindow,
	requestMinimizeWindow,
	requestToggleMaximize,
} from "@/lib/electrobunRpc";

function useElectrobunReady(): boolean {
	const [ready, setReady] = useState(() => isElectrobunWebview());

	useEffect(() => {
		if (ready) return;
		if (isElectrobunWebview()) {
			setReady(true);
			return;
		}
		let cancelled = false;
		const start = performance.now();
		const id = window.setInterval(() => {
			if (cancelled) return;
			if (isElectrobunWebview()) {
				setReady(true);
				window.clearInterval(id);
			} else if (performance.now() - start > 3000) {
				window.clearInterval(id);
			}
		}, 32);
		return () => {
			cancelled = true;
			window.clearInterval(id);
		};
	}, [ready]);

	return ready;
}

const isMacOs =
	typeof navigator !== "undefined" &&
	/Mac|Macintosh|Mac OS X/.test(navigator.userAgent);

/**
 * Frameless-window chrome: draggable region + window controls (Electrobun only).
 * @see https://blackboard.sh/electrobun/docs/apis/browser/draggable-regions/
 */
export function AppTitleBar() {
	const embedded = useElectrobunReady();

	useEffect(() => {
		if (embedded) bootElectrobunMainView();
	}, [embedded]);

	if (!embedded) return null;

	return (
		<div
			className={cn(
				"flex h-10 w-full min-w-0 shrink-0 select-none items-center bg-background px-2",
				"cursor-move electrobun-webkit-app-region-drag",
				isMacOs && "pl-[76px]",
			)}
			onDoubleClick={() => requestToggleMaximize()}
		>
			<div className="flex min-w-0 flex-1 items-center pl-2">
				<span className="truncate text-sm font-medium tracking-tight text-foreground">
					Cross TTS
				</span>
			</div>
			<div
				className="flex shrink-0 cursor-default items-center gap-1 electrobun-webkit-app-region-no-drag"
				onDoubleClick={(e) => e.stopPropagation()}
			>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="h-8 w-8 shrink-0 border-border bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
					aria-label="Minimize"
					title="Minimize"
					onClick={() => requestMinimizeWindow()}
				>
					<Minus className="size-4" aria-hidden />
				</Button>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="h-8 w-8 shrink-0 border-border bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
					aria-label="Maximize or restore"
					title="Maximize"
					onClick={() => requestToggleMaximize()}
				>
					<Maximize2 className="size-3.5" aria-hidden />
				</Button>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="h-8 w-8 shrink-0 border-border bg-background text-foreground shadow-sm hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
					aria-label="Close"
					title="Close"
					onClick={() => requestCloseWindow()}
				>
					<X className="size-4" aria-hidden />
				</Button>
			</div>
		</div>
	);
}
