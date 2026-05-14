import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectrobunConfig } from "electrobun";

const pkg = JSON.parse(
	readFileSync(join(import.meta.dir, "package.json"), "utf8"),
) as { version: string };

export default {
	app: {
		name: "Cross TTS",
		identifier: "dev.cross-tts.app",
		version: pkg.version,
	},
	release: {
		generatePatch: false,
	},
	build: {
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
