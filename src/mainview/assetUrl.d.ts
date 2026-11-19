/** Vite `?url` imports: the file is emitted as a build asset; this is its URL. */
declare module "*?url" {
	const url: string;
	export default url;
}

/** Vite `?raw` imports: the file's text, inlined into the bundle. */
declare module "*?raw" {
	const text: string;
	export default text;
}
