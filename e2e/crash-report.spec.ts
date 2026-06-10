import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test, type ElectronApplication } from "@playwright/test";
import { crashRecordToJson, type CrashRecord } from "../src/shared/crashReport";

const REPO_ROOT = resolve(__dirname, "..");
const MAIN_BUNDLE = join(REPO_ROOT, "out", "main", "index.js");

const FAKE_CRASH: CrashRecord = {
	v: 1,
	timestamp: "2026-06-09T21:00:00.000Z",
	appVersion: "1.9.18",
	platform: `${process.platform} ${process.arch}`,
	kind: "uncaughtException",
	name: "TypeError",
	message: "e2e fixture crash",
	stack: "TypeError: e2e fixture crash\n    at fake (index.js:1:1)",
};

/**
 * Seed an unreported crash record into the sandboxed data dir, launch the app,
 * and verify the opt-in crash dialog: it shows the exact JSON, "Dismiss" with
 * "Don't ask again" deletes the stored record and persists the preference.
 * Nothing is reported automatically — this flow never touches the network.
 */
test("crash dialog appears after a crash and dismiss clears it", async () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "cross-tts-e2e-crash-"));
	let electronApp: ElectronApplication | null = null;

	try {
		const userDataDir = join(tempRoot, "user-data");
		const crashesDir = join(userDataDir, "crashes");
		mkdirSync(crashesDir, { recursive: true });
		const crashFile = join(crashesDir, "crash-1765000000000-0.json");
		writeFileSync(crashFile, crashRecordToJson(FAKE_CRASH));

		electronApp = await _electron.launch({
			args: [MAIN_BUNDLE, "--no-sandbox", "--disable-gpu"],
			env: {
				...process.env,
				CROSS_TTS_E2E_USER_DATA: userDataDir,
				ELECTRON_RENDERER_URL: "",
			},
		});
		const page = await electronApp.firstWindow();

		await test.step("dialog shows the crash and its exact JSON", async () => {
			await expect(
				page.getByText("Cross TTS crashed last time"),
			).toBeVisible();
			await expect(page.getByText("TypeError: e2e fixture crash")).toBeVisible();
			// The collapsible preview shows the verbatim record JSON.
			await page
				.getByRole("button", { name: /show exactly what would be reported/i })
				.click();
			await expect(page.locator("pre")).toContainText('"kind": "uncaughtException"');
			await expect(page.locator("pre")).toContainText('"message": "e2e fixture crash"');
		});

		await test.step("dismiss with don't-ask-again clears records and persists the pref", async () => {
			await page.getByText("Don't ask again after crashes").click();
			await page.getByRole("button", { name: "Dismiss" }).click();
			await expect(page.getByText("Cross TTS crashed last time")).toBeHidden();
			// The stored record was handled (deleted) ...
			await expect.poll(() => existsSync(crashFile)).toBe(false);
			// ... and the preference reached the bootstrap config on disk.
			await expect
				.poll(() => {
					try {
						const cfg = JSON.parse(
							readFileSync(join(userDataDir, "app-config.json"), "utf8"),
						) as { crashPromptDisabled?: boolean };
						return cfg.crashPromptDisabled === true;
					} catch {
						return false;
					}
				})
				.toBe(true);
		});

		await test.step("a main-process exception is captured to a new record", async () => {
			await electronApp!.evaluate(() => {
				// Fire the real uncaughtException path without killing the process.
				(process.emit as (event: string, error: Error) => boolean)(
					"uncaughtException",
					new Error("e2e injected crash"),
				);
			});
			await expect
				.poll(() => {
					try {
						return readdirSync(crashesDir).filter((f) => f.endsWith(".json")).length;
					} catch {
						return 0;
					}
				})
				.toBeGreaterThanOrEqual(1);
		});
	} finally {
		await electronApp?.close().catch(() => {});
		rmSync(tempRoot, { recursive: true, force: true });
	}
});
