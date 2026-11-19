import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { protocol } from "electron";

/**
 * Custom scheme for the production renderer. Loading the app from a real,
 * secure origin (instead of file://) lets us attach cross-origin-isolation
 * headers, which is what makes `SharedArrayBuffer` available — and SAB is what
 * ONNX Runtime's wasm backend needs to run CPU synthesis multi-threaded.
 * file:// can't be cross-origin isolated, so on machines without a usable GPU
 * the model would otherwise run single-threaded and playback lags.
 */
export const APP_SCHEME = "app";
const APP_HOST = "bundle";

export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

const MIME: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".wasm": "application/wasm",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".map": "application/json",
	".txt": "text/plain",
};

/**
 * Cross-origin isolation headers. COEP `credentialless` (rather than
 * `require-corp`) keeps the cross-origin Kokoro model fetch from the local hub
 * working without every response needing a CORP header.
 */
const COI_HEADERS: Record<string, string> = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "credentialless",
	"Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * CSP sent as a header on every app:// response. It stacks with the meta-tag
 * CSP in index.html (both are enforced), and unlike the meta tag it also
 * covers worker scripts (the TTS worker and the ORT threads it spawns).
 * The dev server (http://localhost:5173) isn't served from here, so dev keeps
 * only the permissive meta policy that Vite HMR needs.
 *
 * - wasm-unsafe-eval: ONNX Runtime wasm/JSEP backends.
 * - cdn.jsdelivr.net: transformers.js defaults ORT's wasmPaths to its CDN and
 *   the TTS worker doesn't override it, so ORT's .mjs/.wasm come from there
 *   (verified: without it the wasm backend fails to load). Drop it once
 *   wasmPaths points at the bundled assets.
 * - blob: in script-src: ORT fetches its .mjs and imports it from a blob URL
 *   (verified: without it the wasm backend fails). worker-src blob: for the
 *   ORT thread workers.
 * - 127.0.0.1:* is the local Kokoro hub; huggingface.co (+ its LFS/xet CDNs)
 *   is the fallback when the hub is down; dictionaryapi.dev and gstatic serve
 *   dictionary lookups and pronunciation audio.
 */
const CSP = [
	"default-src 'self'",
	"script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
	"worker-src 'self' blob:",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"media-src 'self' blob: data:",
	"connect-src 'self' blob: data: http://127.0.0.1:* https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co https://api.dictionaryapi.dev https://ssl.gstatic.com",
	"object-src 'none'",
	"frame-src 'none'",
	"frame-ancestors 'none'",
	"base-uri 'self'",
	"form-action 'none'",
].join("; ");

/** Must be called before the app `ready` event. */
export function registerAppScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: APP_SCHEME,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				stream: true,
				codeCache: true,
			},
		},
	]);
}

/** Map a request pathname to a file under `rendererRoot`, or null if it escapes. */
function resolveAssetPath(rendererRoot: string, pathname: string): string | null {
	const rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
	if (rel.includes("\0")) return null;
	const abs = resolve(normalize(join(rendererRoot, ...rel.split("/"))));
	const root = resolve(rendererRoot);
	const r = relative(root, abs);
	if (r === ".." || r.startsWith(`..${sep}`)) return null;
	return abs;
}

/**
 * Register the `app://` handler. Serves the built renderer from `rendererRoot`
 * with cross-origin-isolation headers. Call after the app `ready` event.
 */
export function handleAppRequests(rendererRoot: string): void {
	protocol.handle(APP_SCHEME, async (request) => {
		let pathname = new URL(request.url).pathname;
		if (pathname === "/" || pathname === "") pathname = "/index.html";
		const filePath = resolveAssetPath(rendererRoot, pathname);
		if (!filePath) return new Response("Bad path", { status: 400 });
		try {
			const data = await readFile(filePath);
			const headers = new Headers(COI_HEADERS);
			headers.set("Content-Security-Policy", CSP);
			headers.set(
				"Content-Type",
				MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
			);
			return new Response(new Uint8Array(data), { headers });
		} catch {
			return new Response("Not found", { status: 404 });
		}
	});
}
