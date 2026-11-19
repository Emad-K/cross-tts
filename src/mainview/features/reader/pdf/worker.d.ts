/** Vite `?worker` imports: a Worker constructor for the bundled script. */
declare module "*?worker" {
	const WorkerConstructor: new () => Worker;
	export default WorkerConstructor;
}

/** The minified pdf.js build (the package's types describe its default entry). */
declare module "pdfjs-dist/build/pdf.min.mjs" {
	export * from "pdfjs-dist";
}
