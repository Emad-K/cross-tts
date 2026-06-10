import { CloudOff, ExternalLink, Loader2, SearchX, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	dictionaryApiUrl,
	parseDictionaryResponse,
	wiktionaryUrl,
	type DictionaryEntry,
	type DictionaryMeaning,
	type DictionaryPhonetic,
} from "@shared/dictionary";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { openExternal } from "@/lib/desktopBridge";
import { cn } from "@/lib/utils";

type LookupState =
	| { kind: "loading" }
	| { kind: "error" }
	| { kind: "not-found" }
	| { kind: "ready"; entries: DictionaryEntry[] };

/**
 * Dictionary popover for the reader's "Look up" context-menu item. Fetches
 * the free Dictionary API (dictionaryapi.dev) and shows IPA phonetics with
 * playable audio, definitions per part of speech, and a Wiktionary link.
 */
export default function LookupDialog({
	word,
	onClose,
}: {
	word: string;
	onClose: () => void;
}) {
	const [state, setState] = useState<LookupState>({ kind: "loading" });

	useEffect(() => {
		let cancelled = false;
		setState({ kind: "loading" });
		(async () => {
			try {
				const res = await fetch(dictionaryApiUrl(word));
				if (res.status === 404) {
					if (!cancelled) setState({ kind: "not-found" });
					return;
				}
				if (!res.ok) {
					if (!cancelled) setState({ kind: "error" });
					return;
				}
				const entries = parseDictionaryResponse(await res.json());
				if (cancelled) return;
				setState(
					entries.length > 0
						? { kind: "ready", entries }
						: { kind: "not-found" },
				);
			} catch {
				if (!cancelled) setState({ kind: "error" });
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [word]);

	const title =
		state.kind === "ready" ? (state.entries[0]?.word ?? word) : word;

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-md gap-3">
				<DialogHeader>
					<DialogTitle className="text-2xl">{title}</DialogTitle>
					<DialogDescription className="sr-only">
						Dictionary entry for “{word}”
					</DialogDescription>
				</DialogHeader>
				{state.kind === "loading" ? (
					<StatusNote icon={<Loader2 className="animate-spin" aria-hidden />}>
						Looking up “{word}”…
					</StatusNote>
				) : null}
				{state.kind === "error" ? (
					<StatusNote icon={<CloudOff aria-hidden />}>
						Couldn’t reach the dictionary. Check your connection and try
						again.
					</StatusNote>
				) : null}
				{state.kind === "not-found" ? (
					<StatusNote icon={<SearchX aria-hidden />}>
						No entry found for “{word}”.
					</StatusNote>
				) : null}
				{state.kind === "ready" ? (
					<div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1">
						<PhoneticsRow
							phonetics={dedupedPhonetics(state.entries)}
						/>
						{state.entries.flatMap((entry, entryIdx) =>
							entry.meanings.map((meaning, meaningIdx) => (
								<MeaningCard
									key={`${entryIdx}-${meaningIdx}`}
									meaning={meaning}
								/>
							)),
						)}
					</div>
				) : null}
				<button
					type="button"
					onClick={() => void openExternal(wiktionaryUrl(word))}
					className={cn(
						"inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground",
						"underline-offset-4 transition-colors hover:text-foreground hover:underline",
					)}
				>
					More on Wiktionary
					<ExternalLink className="size-3.5" aria-hidden />
				</button>
			</DialogContent>
		</Dialog>
	);
}

/** Phonetic variants across all entries, deduped (entries often repeat them). */
function dedupedPhonetics(entries: DictionaryEntry[]): DictionaryPhonetic[] {
	const out: DictionaryPhonetic[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		for (const p of entry.phonetics) {
			const key = `${p.text ?? ""}|${p.audioUrl ?? ""}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(p);
		}
	}
	return out;
}

function StatusNote({
	icon,
	children,
}: {
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3",
				"text-sm text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0",
			)}
		>
			{icon}
			<span>{children}</span>
		</div>
	);
}

function PhoneticsRow({ phonetics }: { phonetics: DictionaryPhonetic[] }) {
	if (phonetics.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
			{phonetics.map((p, idx) => (
				<span
					key={`${p.text ?? ""}|${p.audioUrl ?? ""}|${idx}`}
					className="inline-flex items-center gap-1 text-sm text-muted-foreground"
				>
					{p.text ? <span className="font-mono">{p.text}</span> : null}
					{p.audioUrl ? <PlayAudioButton url={p.audioUrl} /> : null}
				</span>
			))}
		</div>
	);
}

/**
 * Pronunciation playback. The page CSP's media-src has no `https:`, so the
 * clip is fetched (connect-src allows https) and played from a blob URL.
 */
function PlayAudioButton({ url }: { url: string }) {
	const [busy, setBusy] = useState(false);
	const blobUrlRef = useRef<string | null>(null);

	useEffect(
		() => () => {
			if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
		},
		[],
	);

	const play = async () => {
		setBusy(true);
		try {
			if (!blobUrlRef.current) {
				const res = await fetch(url);
				if (!res.ok) return;
				blobUrlRef.current = URL.createObjectURL(await res.blob());
			}
			await new Audio(blobUrlRef.current).play();
		} catch {
			// Pronunciation audio is best-effort; ignore playback failures.
		} finally {
			setBusy(false);
		}
	};

	return (
		<button
			type="button"
			onClick={() => void play()}
			disabled={busy}
			aria-label="Play pronunciation"
			title="Play pronunciation"
			className={cn(
				"flex size-6 items-center justify-center rounded-md text-muted-foreground transition",
				"hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
			)}
		>
			{busy ? (
				<Loader2 className="size-3.5 animate-spin" aria-hidden />
			) : (
				<Volume2 className="size-3.5" aria-hidden />
			)}
		</button>
	);
}

function MeaningCard({ meaning }: { meaning: DictionaryMeaning }) {
	return (
		<div className="rounded-lg border border-border bg-muted/20 p-3">
			{meaning.partOfSpeech ? (
				<p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{meaning.partOfSpeech}
				</p>
			) : null}
			<ol className="list-decimal space-y-1.5 pl-5 text-sm">
				{meaning.definitions.map((def, idx) => (
					<li key={idx}>
						{def.definition}
						{def.example ? (
							<span className="block text-muted-foreground">
								“{def.example}”
							</span>
						) : null}
					</li>
				))}
			</ol>
		</div>
	);
}
