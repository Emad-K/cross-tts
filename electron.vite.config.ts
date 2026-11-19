import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

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
		plugins: [react()],
		worker: { format: "es" },
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
