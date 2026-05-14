import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ChangeEvent,
} from "react";
import { ReaderShell } from "./ReaderShell";
import { SAMPLE_TXT_DOCUMENT } from "./fixtures/sample-document";
import {
	loadPersistedReaderState,
	subscribeDebouncedSessionSave,
	touchSessionSave,
} from "./sessionPersistence";
import type { LoadedDocument } from "./types";
import { stopPlaybackUi, useTtsStore } from "./tts";

function readTxtFile(file: File): Promise<LoadedDocument> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const text =
				typeof reader.result === "string" ? reader.result : "";
			resolve({
				format: "txt",
				fileName: file.name,
				text,
			});
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsText(file);
	});
}

/**
 * Top-level reader feature: owns document state and file picking for .txt v1.
 */
export function ReaderApp() {
	const inputRef = useRef<HTMLInputElement>(null);
	const [document, setDocument] = useState<LoadedDocument | null>(null);
	const [sessionReady, setSessionReady] = useState(false);
	const documentRef = useRef(document);
	documentRef.current = document;

	const pendingChunkIndexRef = useRef<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const { document: doc, pendingChunkIndex } =
					await loadPersistedReaderState();
				if (cancelled) return;
				if (doc) {
					pendingChunkIndexRef.current = pendingChunkIndex;
					setDocument(doc);
				}
			} finally {
				setSessionReady(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!sessionReady) return;
		if (document) {
			const pending = pendingChunkIndexRef.current;
			pendingChunkIndexRef.current = null;
			const opts =
				pending !== null && pending !== undefined
					? { chunkIndex: pending }
					: undefined;
			useTtsStore.getState().setSourceText(document.text, opts);
		} else {
			stopPlaybackUi();
			useTtsStore.getState().setSourceText("");
		}
	}, [document, sessionReady]);

	useEffect(() => {
		if (!sessionReady) return;
		return subscribeDebouncedSessionSave(() => documentRef.current);
	}, [sessionReady]);

	useEffect(() => {
		if (!sessionReady) return;
		touchSessionSave();
	}, [document, sessionReady]);

	const openFilePicker = useCallback(() => {
		inputRef.current?.click();
	}, []);

	const onFileChange = useCallback(
		async (e: ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			e.target.value = "";
			if (!file) return;
			if (!file.name.toLowerCase().endsWith(".txt")) {
				return;
			}
			try {
				setDocument(await readTxtFile(file));
			} catch {
				// Engine / toast layer can surface errors later.
			}
		},
		[],
	);

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
			<input
				ref={inputRef}
				type="file"
				accept=".txt,text/plain"
				className="sr-only"
				aria-hidden
				tabIndex={-1}
				onChange={onFileChange}
			/>
			<ReaderShell
				className="min-h-0 flex-1"
				document={document}
				onOpenFile={openFilePicker}
				onOpenSettings={() => {
					/* settings surface later */
				}}
				onLoadSample={() => setDocument(SAMPLE_TXT_DOCUMENT)}
			/>
		</div>
	);
}
