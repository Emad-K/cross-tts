import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dismissToast, useToastStore } from "./toastStore";

/** Fixed top-right stack of in-app toasts. Render once at the app root. */
export function Toaster() {
	const toasts = useToastStore((s) => s.toasts);
	if (toasts.length === 0) return null;

	return (
		<div
			className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
			role="region"
			aria-label="Notifications"
		>
			{toasts.map((toast) => (
				<div
					key={toast.id}
					role="status"
					aria-live="polite"
					className={cn(
						"pointer-events-auto rounded-lg border bg-background p-3 shadow-lg",
						toast.variant === "destructive"
							? "border-destructive/50 text-destructive"
							: "border-border",
					)}
				>
					<div className="flex items-start gap-2">
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium">{toast.title}</p>
							{toast.description ? (
								<p className="mt-0.5 text-xs text-muted-foreground">
									{toast.description}
								</p>
							) : null}
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="-mr-1 -mt-1 size-6 shrink-0 text-muted-foreground"
							aria-label="Dismiss notification"
							onClick={() => dismissToast(toast.id)}
						>
							<X className="size-3.5" />
						</Button>
					</div>
					{toast.action ? (
						<div className="mt-2 flex justify-end">
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 px-2.5 text-xs"
								onClick={() => {
									dismissToast(toast.id);
									toast.action?.onClick();
								}}
							>
								{toast.action.label}
							</Button>
						</div>
					) : null}
				</div>
			))}
		</div>
	);
}
