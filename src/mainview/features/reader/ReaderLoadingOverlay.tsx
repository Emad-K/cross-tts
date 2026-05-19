import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ReaderLoadingOverlayProps = {
	message: string;
	className?: string;
};

export function ReaderLoadingOverlay({
	message,
	className,
}: ReaderLoadingOverlayProps) {
	return (
		<div
			className={cn(
				"absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm",
				className,
			)}
			role="status"
			aria-live="polite"
			aria-busy="true"
		>
			<Loader2
				className="size-8 animate-spin text-muted-foreground"
				aria-hidden
			/>
			<p className="text-sm text-muted-foreground">{message}</p>
		</div>
	);
}
