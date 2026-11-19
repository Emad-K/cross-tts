import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test, type ElectronApplication } from "@playwright/test";

const MAIN_BUNDLE = join(resolve(__dirname, ".."), "out", "main", "index.js");

/**
 * A brand-new install (empty userData) gets the welcome once. Walking through
 * it must not download anything: the sample button stays off until the model
 * is on disk, and only the Download button (never pressed here) fetches it.
 */
test("a fresh install sees the welcome, which downloads nothing", async () => {
	const root = mkdtempSync(join(tmpdir(), "cross-tts-e2e-welcome-"));
	const userData = join(root, "user-data");
	mkdirSync(userData, { recursive: true });
	let app: ElectronApplication | null = null;
	try {
		app = await _electron.launch({
			args: [MAIN_BUNDLE, "--no-sandbox", "--disable-gpu"],
			env: {
				...(process.env as Record<string, string>),
				CROSS_TTS_E2E_USER_DATA: userData,
				ELECTRON_RENDERER_URL: "",
			},
		});
		const page = await app.firstWindow();
		const welcome = page.getByRole("dialog");
		const heading = (name: string) => welcome.getByRole("heading", { name });

		await expect(heading("Welcome to Cross TTS")).toBeVisible();
		// Keyboard only: Next has the focus.
		await page.keyboard.press("Enter");
		await expect(heading("Choose a voice")).toBeVisible();
		await expect(welcome.getByRole("radiogroup", { name: "Voice engine" })).toBeVisible();
		await expect(welcome.getByRole("button", { name: /^Download Kokoro/ })).toBeVisible();
		await expect(welcome.getByRole("button", { name: "Hear a sample" })).toBeDisabled();
		await page.keyboard.press("Enter");
		await expect(heading("Start listening")).toBeVisible();
		await welcome.getByRole("button", { name: "Try the sample book" }).click();
		await expect(welcome).toBeHidden();
		await expect(page.getByText("In my younger and more vulnerable years")).toBeVisible();

		// Shown once: the flag is stored, and no model was fetched.
		await expect
			.poll(() => JSON.parse(readFileSync(join(userData, "app-config.json"), "utf8")).welcomeSeen)
			.toBe(true);
		// The app makes the (empty) model folder at startup; nothing is in it.
		const modelFiles = readdirSync(join(userData, "kokoro-hf-hub"), {
			recursive: true,
			withFileTypes: true,
		}).filter((e) => e.isFile());
		expect(modelFiles.map((e) => e.name)).toEqual([]);

		// Settings → General brings it back, in place of Settings.
		await page.getByRole("button", { name: "Settings" }).click();
		await page.getByRole("button", { name: "General", exact: true }).click();
		await page.getByRole("button", { name: "Show welcome again" }).click();
		await expect(heading("Welcome to Cross TTS")).toBeVisible();
		await expect(page.getByRole("button", { name: "Show welcome again" })).toBeHidden();
		await welcome.getByRole("button", { name: "Skip for now" }).click();
		await expect(page.getByRole("dialog")).toBeHidden();
	} finally {
		await app?.close().catch(() => {});
		rmSync(root, { recursive: true, force: true });
	}
});
