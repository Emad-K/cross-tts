import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test, type ElectronApplication } from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..");
const MAIN_BUNDLE = join(REPO_ROOT, "out", "main", "index.js");
const ARGS = [MAIN_BUNDLE, "--no-sandbox", "--disable-gpu"];

/** A sandboxed userData folder with "Keep playing when the window is closed" on. */
function sandbox(): { root: string; env: Record<string, string> } {
	const root = mkdtempSync(join(tmpdir(), "cross-tts-e2e-tray-"));
	const userData = join(root, "user-data");
	mkdirSync(userData, { recursive: true });
	writeFileSync(
		join(userData, "app-config.json"),
		JSON.stringify({ version: 2, keepPlayingInBackground: true }),
	);
	return {
		root,
		env: {
			...(process.env as Record<string, string>),
			CROSS_TTS_E2E_USER_DATA: userData,
			ELECTRON_RENDERER_URL: "",
			// Keep the test's tray icon off the desktop of whoever runs it.
			DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent-cross-tts-e2e",
		},
	};
}

const windowState = (app: ElectronApplication) =>
	app.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows().map((w) => w.isVisible()),
	);

const closeWindow = (app: ElectronApplication) =>
	app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());

/**
 * Audio plays in the window's renderer, so with the setting on, closing the
 * window must hide it (not destroy it), a second launch must bring it back,
 * and Quit must still really quit. CROSS_TTS_E2E_TRAY stands in for a desktop
 * with a tray; no real tray icon is needed.
 */
test("closing hides the window to the tray, relaunch shows it, quit quits", async () => {
	const { root, env } = sandbox();
	let app: ElectronApplication | null = null;
	try {
		app = await _electron.launch({
			args: ARGS,
			env: { ...env, CROSS_TTS_E2E_TRAY: "1" },
		});
		const page = await app.firstWindow();
		await expect(page.getByRole("heading", { name: "Open a document" })).toBeVisible();
		expect(await windowState(app)).toEqual([true]);

		await closeWindow(app);
		await expect.poll(() => windowState(app!)).toEqual([false]);
		// The page is still alive behind the hidden window.
		expect(await page.evaluate(() => document.readyState)).toBe("complete");

		// Starting the app again exits at once and hands over to the first copy.
		const electronPath = (await import("electron")).default as unknown as string;
		const second = spawn(electronPath, ARGS, {
			env: { ...env, CROSS_TTS_E2E_TRAY: "1" },
			stdio: "ignore",
		});
		const code = await new Promise<number | null>((done) => second.on("exit", done));
		expect(code).toBe(0);
		await expect.poll(() => windowState(app!)).toEqual([true]);

		// Hidden again, then Quit: the hide-on-close must not block it.
		await closeWindow(app);
		await expect.poll(() => windowState(app!)).toEqual([false]);
		const closed = app.waitForEvent("close");
		await app.evaluate(({ app: a }) => a.quit());
		await closed;
		app = null;
	} finally {
		await app?.close().catch(() => {});
		rmSync(root, { recursive: true, force: true });
	}
});

test("without a tray, closing the window quits even with the setting on", async () => {
	const { root, env } = sandbox();
	let app: ElectronApplication | null = null;
	try {
		app = await _electron.launch({
			args: ARGS,
			env: { ...env, CROSS_TTS_E2E_TRAY: "0" },
		});
		await app.firstWindow();
		const closed = app.waitForEvent("close");
		await closeWindow(app).catch(() => {});
		await closed;
		app = null;
	} finally {
		await app?.close().catch(() => {});
		rmSync(root, { recursive: true, force: true });
	}
});

test("a library book whose file is gone is marked Missing", async () => {
	const { root, env } = sandbox();
	let app: ElectronApplication | null = null;
	try {
		const here = join(root, "here.txt");
		const gone = join(root, "gone.txt");
		writeFileSync(here, "Hello.");
		const entry = (path: string, title: string) => ({
			path,
			title,
			format: "txt",
			chapterId: null,
			chunkIndex: 0,
			updatedAt: 1,
		});
		writeFileSync(
			join(env.CROSS_TTS_E2E_USER_DATA!, "app-session.json"),
			JSON.stringify({
				version: 1,
				window: null,
				maximized: false,
				fullScreen: false,
				web: {
					books: {
						[here]: entry(here, "Still here"),
						[gone]: entry(gone, "Moved away"),
					},
				},
			}),
		);
		app = await _electron.launch({ args: ARGS, env });
		const page = await app.firstWindow();
		const card = (title: string) => page.locator(`button[title="${title}"]`);
		await expect(card("Moved away")).toContainText("Missing");
		await expect(card("Still here")).toBeVisible();
		await expect(card("Still here")).not.toContainText("Missing");
	} finally {
		await app?.close().catch(() => {});
		rmSync(root, { recursive: true, force: true });
	}
});
