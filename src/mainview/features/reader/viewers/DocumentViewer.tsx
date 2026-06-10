import { lazy, Suspense, useState } from "react";
import type { LoadedDocument } from "../types";
import { seekToChunkAndPlay, useTtsStore } from "../tts";
import { ViewerContextMenu } from "../contextMenu/ViewerContextMenu";
import { EpubViewer } from "./EpubViewer";
import { TxtViewer } from "./TxtViewer";

const LookupDialog = lazy(() => import("../contextMenu/LookupDialog"));

type DocumentViewerProps = {
	document: LoadedDocument;
	activeChapterId: string | null;
};

type MenuState = { x: number; y: number; selection: string };

/**
 * Routes the active {@link LoadedDocument} to the correct viewer and hosts
 * the shared right-click menu (Copy / Find / Look up) for both viewers.
 */
export function DocumentViewer({
	document,
	activeChapterId,
}: DocumentViewerProps) {
	const highlightRange = useTtsStore((s) => s.highlightRange);
	const chunks = useTtsStore((s) => s.chunks);
	const currentChunkIndex = useTtsStore((s) => s.currentChunkIndex);
	const [menu, setMenu] = useState<MenuState | null>(null);
	const [lookupWord, setLookupWord] = useState<string | null>(null);

	const renderViewer = () => {
		switch (document.format) {
			case "txt":
				return (
					<TxtViewer
						text={document.text}
						highlightRange={highlightRange}
						chunks={chunks}
						activeChunkIndex={currentChunkIndex}
						onChunkClick={(i) => seekToChunkAndPlay(i)}
					/>
				);
			case "epub":
				if (!activeChapterId) {
					return (
						<div className="flex min-h-[12rem] items-center justify-center px-8 py-16">
							<p className="text-sm text-muted-foreground">
								Select a chapter to begin reading.
							</p>
						</div>
					);
				}
				return (
					<EpubViewer
						filePath={document.filePath}
						chapterId={activeChapterId}
						chunks={chunks}
						activeChunkIndex={currentChunkIndex}
						highlightRange={highlightRange}
						onChunkClick={(i) => seekToChunkAndPlay(i)}
					/>
				);
		}
	};

	return (
		// Suppress Electron's default (empty) context menu and show ours.
		// Right click never reaches the chunk spans' onClick, so it cannot
		// trigger seek-to-chunk; preventDefault keeps the selection intact.
		<div
			onContextMenu={(e) => {
				e.preventDefault();
				setMenu({
					x: e.clientX,
					y: e.clientY,
					selection: window.getSelection()?.toString() ?? "",
				});
			}}
		>
			{renderViewer()}
			{menu ? (
				<ViewerContextMenu
					x={menu.x}
					y={menu.y}
					selection={menu.selection}
					onClose={() => setMenu(null)}
					onLookup={(word) => setLookupWord(word)}
				/>
			) : null}
			{lookupWord ? (
				<Suspense fallback={null}>
					<LookupDialog
						word={lookupWord}
						onClose={() => setLookupWord(null)}
					/>
				</Suspense>
			) : null}
		</div>
	);
}
