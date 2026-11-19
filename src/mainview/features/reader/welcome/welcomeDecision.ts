/**
 * Whether to show the first-run welcome. It is for a new install only: someone
 * upgrading already has a voice model on disk, books in the library or a book
 * that reopened, and must not be walked through setup again.
 */
export function shouldShowWelcome(s: {
	welcomeSeen: boolean;
	modelsDownloaded: boolean;
	libraryCount: number;
	hasOpenDocument: boolean;
}): boolean {
	return (
		!s.welcomeSeen && !s.modelsDownloaded && s.libraryCount === 0 && !s.hasOpenDocument
	);
}
