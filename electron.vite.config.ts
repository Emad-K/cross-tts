import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";

/**
 * Ships pdf.js's CMap tables as renderer files under /cmaps/ (about 1.7 MB,
 * 169 small files). pdf.js fetches one when a PDF's font names a predefined
 * CMap, which is how most Chinese, Japanese and Korean PDFs store text.
 */
function pdfCmaps(): Plugin {
	const dir = resolve(__dirname, "node_modules/pdfjs-dist/cmaps");
	return {
		name: "pdf-cmaps",
		generateBundle() {
			for (const name of readdirSync(dir)) {
				this.emitFile({
					type: "asset",
					fileName: `cmaps/${name}`,
					source: readFileSync(join(dir, name)),
				});
			}
		},
		configureServer(server) {
			server.middlewares.use("/cmaps", (req, res, next) => {
				const file = join(dir, basename(req.url ?? ""));
				if (existsSync(file)) res.end(readFileSync(file));
				else next();
			});
		},
	};
}

export default defineConfig({
	main: {
		// sanitize-html >=2.18 depends on ESM-only htmlparser2, which Electron
		// 33's Node can't require(); bundle it so Rollup converts it to CJS.
		plugins: [externalizeDepsPlugin({ exclude: ["sanitize-html"] })],
		resolve: {
			alias: {
				"@shared": resolve(__dirname, "src/shared"),
			},
		},
		build: {
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/bun/index.ts"),
					// Utility-process entry: native CPU synthesis on onnxruntime-node.
					ttsNodeWorker: resolve(__dirname, "src/bun/ttsNodeWorker.ts"),
					supertonicNodeWorker: resolve(
						__dirname,
						"src/bun/supertonicNodeWorker.ts",
					),
				},
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: { index: resolve(__dirname, "src/preload/index.ts") },
			},
		},
	},
	renderer: {
		root: "src/mainview",
		plugins: [react(), pdfCmaps()],
		worker: { format: "es" },
		// phonon-tts finds its worker and wasm through `new URL(..., import.meta.url)`,
		// which dependency pre-bundling breaks in dev.
		optimizeDeps: { exclude: ["phonon-tts"] },
		resolve: {
			alias: {
				"@": resolve(__dirname, "src/mainview"),
				"@shared": resolve(__dirname, "src/shared"),
			},
		},
		build: {
			target: "esnext",
			rollupOptions: {
				input: { index: resolve(__dirname, "src/mainview/index.html") },
			},
		},
		server: {
			port: 5173,
			strictPort: true,
			// Match the production app:// scheme: cross-origin isolation in dev so
			// SharedArrayBuffer (ONNX Runtime wasm threads) is available there too.
			headers: {
				"Cross-Origin-Opener-Policy": "same-origin",
				"Cross-Origin-Embedder-Policy": "credentialless",
			},
		},
	},
});
