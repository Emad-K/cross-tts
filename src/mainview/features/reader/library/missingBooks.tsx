import { useEffect } from "react";
import { create } from "zustand";
import { useLibraryStore } from "./libraryStore";

/** Library books whose file isn't where it was (moved, deleted, drive unplugged). */
const useMissingBooksStore = create<{ missing: ReadonlySet<string> }>(() => ({
	missing: new Set(),
}));

let timer: ReturnType<typeof setTimeout> | null = null;

/** Look again for every library file. Calls made close together share one look. */
export function checkMissingBooks(): void {
	if (timer !== null || !window.api) return;
	timer = setTimeout(() => {
		timer = null;
		const paths = Object.keys(useLibraryStore.getState().books);
		void window.api?.request
			.missingPaths({ paths })
			.then((missing) =>
				useMissingBooksStore.setState({ missing: new Set(missing) }),
			)
			.catch(() => {});
	}, 100);
}

/** "Missing" label on a library card whose file can't be found. */
export function MissingBadge({ path }: { path: string }) {
	const missing = useMissingBooksStore((s) => s.missing.has(path));
	useEffect(checkMissingBooks, []);
	if (!missing) return null;
	return (
		<span
			className="absolute left-1.5 top-1.5 rounded bg-destructive px-1.5 py-0.5 text-[11px] font-medium text-destructive-foreground shadow"
			title={`The file wasn't found. It may have been moved, renamed or deleted, or its drive isn't connected: ${path}`}
		>
			Missing
		</span>
	);
}
