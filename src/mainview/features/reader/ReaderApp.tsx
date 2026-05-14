import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { ReaderShell } from "./ReaderShell";
import { SAMPLE_TXT_DOCUMENT } from "./fixtures/sample-document";
import type { LoadedDocument } from "./types";

const DEMO_HIGHLIGHT =
	"just remember that all the people in this world haven't had the advantages that you've had.";

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

	const openFilePicker = useCallback(() => {
		inputRef.current?.click();
	}, []);

	const onFileChange = useCallback(
		async (e: ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			e.target.value = "";
			if (!file) return;
			if (!file.name.toLowerCase().endsWith(".txt")) {
				// v1: only txt; later a format registry can validate / route.
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
				highlightPhrase={document ? DEMO_HIGHLIGHT : undefined}
				onOpenFile={openFilePicker}
				onOpenSettings={() => {
					/* settings surface later */
				}}
				onLoadSample={() => setDocument(SAMPLE_TXT_DOCUMENT)}
			/>
		</div>
	);
}
