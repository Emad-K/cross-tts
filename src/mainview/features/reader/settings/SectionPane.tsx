import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

export type SettingsSectionId = "voice" | "appearance" | "rules" | "shortcuts" | "general";

/** Whole mebibytes, the unit every download size is shown in. */
export const mb = (bytes: number) => Math.round(bytes / 1_048_576);

/** Shared right-pane shell of a Settings tab: fixed header + scrollable body. */
export function SectionPane({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12">
				<h2 className="text-base font-semibold leading-none">{title}</h2>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			<ScrollArea className="min-h-0 w-full flex-1">
				<div className="px-6 py-5">{children}</div>
			</ScrollArea>
		</div>
	);
}

/** A titled group of controls inside a tab. */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="mt-6 space-y-3 first:mt-0">
			<h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{title}
			</h3>
			{children}
		</section>
	);
}
