import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: { index: resolve(__dirname, "src/bun/index.ts") },
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
