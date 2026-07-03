import { Monitor, Moon, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
	FONTS,
	FONT_SCALE_MAX,
	FONT_SCALE_MIN,
	FONT_SCALE_STEP,
	MAX_CHUNK_CHARS_MAX,
	MAX_CHUNK_CHARS_MIN,
	MAX_CHUNK_CHARS_STEP,
	READER_PADDINGS,
	THEMES,
	type ColorMode,
	type ReaderPadding,
	defaultAppearance,
	fontStack,
} from "@shared/appearance";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useTtsStore } from "../tts";
import { useAppSettingsStore } from "./appSettingsStore";

const MODES: { id: ColorMode; label: string; icon: typeof Sun }[] = [
	{ id: "system", label: "System", icon: Monitor },
	{ id: "light", label: "Light", icon: Sun },
	{ id: "dark", label: "Dark", icon: Moon },
];

function Field({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="rounded-lg border border-border bg-muted/20 p-4">
			<div className="mb-3 text-sm font-medium">{label}</div>
			{children}
		</div>
	);
}

export function AppearancePanel() {
	const config = useAppSettingsStore((s) => s.config);
	const setAppearance = useAppSettingsStore((s) => s.setAppearance);
	const a = config?.appearance ?? defaultAppearance();

	const [scaleDraft, setScaleDraft] = useState<number | null>(null);
	const scale = scaleDraft ?? a.fontScale;
	const [chunkDraft, setChunkDraft] = useState<number | null>(null);
	const chunkChars = chunkDraft ?? a.maxChunkChars;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12">
				<h2 className="text-base font-semibold leading-none">Appearance</h2>
				<p className="text-sm text-muted-foreground">
					Theme, light/dark mode, and the reading font.
				</p>
			</div>
			<ScrollArea className="min-h-0 w-full flex-1">
				<div className="space-y-3 px-6 py-5">
					<Field label="Color mode">
						<div className="grid grid-cols-3 gap-1 rounded-md border border-border p-1">
							{MODES.map((m) => {
								const Icon = m.icon;
								const active = a.mode === m.id;
								return (
									<button
										key={m.id}
										type="button"
										onClick={() => void setAppearance({ mode: m.id })}
										className={cn(
											"flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors",
											active
												? "bg-foreground text-background"
												: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
										)}
									>
										<Icon className="size-3.5" aria-hidden />
										{m.label}
									</button>
								);
							})}
						</div>
					</Field>

					<Field label="Theme">
						<Select
							value={a.theme}
							onValueChange={(v) =>
								void setAppearance({ theme: v as typeof a.theme })
							}
						>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{THEMES.map((t) => (
									<SelectItem key={t.id} value={t.id}>
										{t.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>

					<Field label="Reading font">
						<Select
							value={a.fontFamily}
							onValueChange={(v) =>
								void setAppearance({ fontFamily: v as typeof a.fontFamily })
							}
						>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{FONTS.map((f) => (
									<SelectItem
										key={f.id}
										value={f.id}
										style={{ fontFamily: f.stack }}
									>
										{f.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p
							className="mt-3 text-sm leading-relaxed text-foreground/80"
							style={{
								fontFamily: fontStack(a.fontFamily),
								fontSize: `${scale}rem`,
							}}
						>
							The quick brown fox jumps over the lazy dog.
						</p>
					</Field>

					<Field label={`Font size · ${scale.toFixed(1)}×`}>
						<Slider
							value={[scale]}
							min={FONT_SCALE_MIN}
							max={FONT_SCALE_MAX}
							step={FONT_SCALE_STEP}
							onValueChange={(v) => setScaleDraft(v[0] ?? 1)}
							onValueCommit={(v) => {
								setScaleDraft(null);
								void setAppearance({ fontScale: v[0] ?? 1 });
							}}
						/>
						<div className="mt-2 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
							<span>Smaller</span>
							<span>Larger</span>
						</div>
					</Field>

					<Field label="Reading padding">
						<Select
							value={a.readerPadding}
							onValueChange={(v) =>
								void setAppearance({ readerPadding: v as ReaderPadding })
							}
						>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{READER_PADDINGS.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										{p.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="mt-2 text-xs text-muted-foreground">
							Space around the document text. Tighter shows more per screen.
						</p>
					</Field>

					<Field label={`Max segment length · ${chunkChars} chars`}>
						<Slider
							value={[chunkChars]}
							min={MAX_CHUNK_CHARS_MIN}
							max={MAX_CHUNK_CHARS_MAX}
							step={MAX_CHUNK_CHARS_STEP}
							onValueChange={(v) => setChunkDraft(v[0] ?? MAX_CHUNK_CHARS_MIN)}
							onValueCommit={(v) => {
								setChunkDraft(null);
								const next = v[0] ?? MAX_CHUNK_CHARS_MIN;
								void setAppearance({ maxChunkChars: next });
								// Rebuild the open document's chunks with the new size.
								useTtsStore.getState().rechunk();
							}}
						/>
						<p className="mt-2 text-xs text-muted-foreground">
							Longest text the engine speaks at once. Shorter = snappier start
							and finer highlighting; longer = fewer breaks. On Linux, raising
							this can make very long segments sound slightly off — keep it
							lower if you notice it.
						</p>
					</Field>
				</div>
			</ScrollArea>
		</div>
	);
}
