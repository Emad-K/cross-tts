import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTtsStore } from "./tts";
import { getTtsEngine } from "./tts/ttsEngines";
import { supertonicLanguageName } from "./tts/supertonicVoices";

/**
 * The selected engine's voices, in the player bar and in Settings → Voice.
 * With `onMore` the menu ends in a link to the Voice settings.
 */
export function VoicePicker({
	className,
	disabled,
	onMore,
}: {
	className?: string;
	disabled?: boolean;
	onMore?: () => void;
}) {
	const voice = useTtsStore((s) => s.voice);
	const engineId = useTtsStore((s) => s.engineId);
	const setVoice = useTtsStore((s) => s.setVoice);

	const voices = useMemo(() => getTtsEngine(engineId).listVoices(), [engineId]);
	/**
	 * Supertonic's voices get one submenu per language; the other engines'
	 * stay a flat list (their default voices must not sit a level down).
	 */
	const byLanguage = useMemo(() => {
		if (engineId !== "supertonic") return null;
		const groups = new Map<string, typeof voices>();
		for (const v of voices) {
			groups.set(v.language, [...(groups.get(v.language) ?? []), v]);
		}
		return [...groups];
	}, [engineId, voices]);

	const current = voices.find((o) => o.id === voice)?.label ?? voice;
	const item = (o: (typeof voices)[number]) => (
		<DropdownMenuItem key={o.id} onClick={() => setVoice(o.id)}>
			{o.label}
		</DropdownMenuItem>
	);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					aria-label={`Voice: ${current}`}
					disabled={disabled}
					className={cn("justify-between gap-2 border-border bg-transparent", className)}
				>
					{current}
					<ChevronDown className="size-4 opacity-70" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[12rem] overflow-hidden p-0">
				<ScrollArea className="h-72">
					<div className="p-1">
						{byLanguage
							? byLanguage.map(([lang, group]) => (
									<DropdownMenuSub key={lang}>
										<DropdownMenuSubTrigger>
											{supertonicLanguageName(lang)}
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent>{group.map(item)}</DropdownMenuSubContent>
									</DropdownMenuSub>
								))
							: voices.map(item)}
					</div>
				</ScrollArea>
				{onMore ? (
					<>
						<DropdownMenuSeparator className="m-0" />
						<div className="p-1">
							<DropdownMenuItem onClick={onMore}>
								More voices and engines…
							</DropdownMenuItem>
						</div>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
