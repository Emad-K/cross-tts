// One-off screenshot capture for the README. NOT part of the test suite.
//
//   pnpm run build            # produces out/main/index.js
//   xvfb-run --auto-servernum -- node e2e/capture-screenshots.mjs
//
// Drives the *built* Electron app against a clean userData sandbox, loads the
// bundled sample document, and writes PNGs to docs/media/. Captures are
// real app output — recapture on your own machine for production polish.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron } from "@playwright/test";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const MAIN_BUNDLE = join(REPO_ROOT, "out", "main", "index.js");
const OUT_DIR = join(REPO_ROOT, "docs", "media");

const WIDTH = 1360;
const HEIGHT = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	const tempRoot = mkdtempSync(join(tmpdir(), "cross-tts-shots-"));
	const userDataDir = join(tempRoot, "user-data");
	mkdirSync(userDataDir, { recursive: true });
	// Seed only a window frame (no document) so the app opens at a presentable
	// size on the empty state.
	writeFileSync(
		join(userDataDir, "app-session.json"),
		JSON.stringify({
			version: 1,
			window: { x: 40, y: 40, width: WIDTH, height: HEIGHT },
			maximized: false,
			fullScreen: false,
			web: null,
		}),
	);

	// Launch via the project dir (not the bundle path) so Electron reads the
	// root package.json — otherwise app.getVersion() reports Electron's own
	// version in this unpackaged run and the settings footer shows it.
	const app = await _electron.launch({
		args: [REPO_ROOT],
		cwd: REPO_ROOT,
		env: {
			...process.env,
			CROSS_TTS_E2E_USER_DATA: userDataDir,
			NODE_ENV: "production",
		},
	});
	const page = await app.firstWindow();
	await page.waitForLoadState("domcontentloaded");
	await sleep(1500);

	const shot = async (name) => {
		const path = join(OUT_DIR, name);
		await page.screenshot({ path });
		console.log("wrote", path);
	};

	// 1. Landing / empty state
	await shot("01-landing.png");

	// 2. Reader with the sample document loaded
	const trySample = page.getByRole("button", { name: "Try sample" });
	if (await trySample.count()) {
		await trySample.first().click();
		await sleep(1800);
		await shot("02-reader.png");
	} else {
		console.log("no 'Try sample' button — skipping reader shot");
	}

	// 3. Settings dialog
	const settings = page.getByRole("button", { name: "Settings" });
	if (await settings.count()) {
		await settings.first().click();
		await sleep(1200);
		await shot("03-settings.png");

		// 4. Flip to dark mode, then re-shoot the reader as the dark hero.
		const dark = page.getByRole("button", { name: "Dark" });
		if (await dark.count()) {
			await dark.first().click();
			await sleep(600);
		}
		await page.keyboard.press("Escape");
		await sleep(800);
		await shot("04-reader-dark.png");
	} else {
		console.log("no Settings button — skipping settings shot");
	}

	await app.close();
	console.log("done");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
