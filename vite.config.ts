import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react()],
	worker: { format: "es" },
	root: "src/mainview",
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src/mainview"),
			"@shared": path.resolve(__dirname, "./src/shared"),
		},
	},
	build: {
		target: "esnext",
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
