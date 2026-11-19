/** electron-vite `?asset` imports (main process): the file's path at runtime. */
declare module "*?asset" {
	const path: string;
	export default path;
}
