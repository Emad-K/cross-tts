import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

const REPO_ROOT = resolve(__dirname, "..");
const MAIN_BUNDLE = join(REPO_ROOT, "out", "main", "index.js");
const FIXTURES = join(REPO_ROOT, "src", "bun", "formats", "fixtures");

/**
 * The formats added in 1.15, in the *built* app: a PDF parsed by pdf.js in a
 * Web Worker under the production CSP, a Word file through the externalized
 * mammoth, Markdown, a scanned PDF's message, and Paste text with Save to
 * library. Books are opened through the same session/library seam as the smoke
 * spec, so no native file dialog is involved. No audio is synthesized.
 */
test("opens PDF, Word and Markdown files and pasted text", async () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "cross-tts-e2e-"));
	let electronApp: ElectronApplication | null = null;

	try {
		const books = join(tempRoot, "books");
		mkdirSync(books);
		const book = (name: string) => {
			copyFileSync(join(FIXTURES, name), join(books, name));
			return join(books, name);
		};
		const pdf = book("outline.pdf");
		const library = Object.fromEntries(
			[
				[book("sample.docx"), "Word sample"],
				[book("sample.md"), "Markdown sample"],
				[book("scanned.pdf"), "Scanned sample"],
			].map(([path, title], i) => [
				path,
				{ path, title, format: "epub", chapterId: null, chunkIndex: 0, updatedAt: i + 1 },
			]),
		);

		const userDataDir = join(tempRoot, "user-data");
		mkdirSync(userDataDir, { recursive: true });
		writeFileSync(
			join(userDataDir, "app-session.json"),
			JSON.stringify({
				version: 1,
				window: null,
				maximized: false,
				fullScreen: false,
				web: {
					documentPath: pdf,
					activeChapterId: "p1",
					currentChunkIndex: 0,
					books: library,
				},
			}),
		);

		electronApp = await _electron.launch({
			args: [MAIN_BUNDLE, "--no-sandbox", "--disable-gpu"],
			env: {
				...process.env,
				CROSS_TTS_E2E_USER_DATA: userDataDir,
				ELECTRON_RENDERER_URL: "",
			},
		});
		const app = electronApp;
		const page: Page = await app.firstWindow();
		const consoleMessages: string[] = [];
		page.on("console", (msg) => consoleMessages.push(msg.text()));

		const body = page.locator(".epub-chapter-body");
		const openFromLibrary = async (title: string) => {
			await page.getByRole("button", { name: "Library", exact: true }).click();
			await page.getByRole("button", { name: title }).first().click();
		};

		await test.step("PDF: outline chapters, joined lines and pages", async () => {
			await expect(body).toContainText(
				"ends with a hyphenated word that must be joined again.",
			);
			await expect(body).toContainText(
				"cut by the page break, then carries on at the top of the next page.",
			);
			// Chapters come from the PDF's outline.
			await expect(page.getByText("Chapter Two", { exact: true })).toBeVisible();
			await expect(page.getByText("Front matter", { exact: true })).toBeVisible();
		});

		await test.step("Word: headings are chapters, styled runs are text", async () => {
			await openFromLibrary("Word sample");
			await expect(body).toContainText("Words before any heading.");
			await page.getByText("First Part", { exact: true }).click();
			await expect(body).toContainText("The first part has bold text.");
		});

		await test.step("Markdown: markers are dropped", async () => {
			await openFromLibrary("Markdown sample");
			await expect(body).toContainText(
				"Intro line before any heading, with bold, emphasis and code.",
			);
		});

		await test.step("a scanned PDF says why it can't be read", async () => {
			await openFromLibrary("Scanned sample");
			await expect(page.getByText("This PDF has no selectable text.")).toBeVisible();
		});

		await test.step("Paste text opens the clipboard; Save to library writes a .txt", async () => {
			await app.evaluate(({ clipboard }) =>
				clipboard.writeText("Pasted headline\n\nPasted body sentence."),
			);
			await page.getByRole("button", { name: "Paste text" }).click();
			await expect(page.locator("main")).toContainText("Pasted body sentence.");

			const saved = join(userDataDir, "pasted", "Pasted headline.txt");
			expect(existsSync(saved)).toBe(false); // nothing is written until asked
			const save = page.getByRole("banner").getByRole("button", { name: "Save to library" });
			await save.click();
			await expect.poll(() => existsSync(saved)).toBe(true);
			await expect(save).toHaveCount(0);
			await expect(page.locator("main")).toContainText("Pasted body sentence.");
		});

		await test.step("Ctrl/Cmd+Shift+V pastes from the library", async () => {
			await page.getByRole("button", { name: "Library", exact: true }).click();
			await app.evaluate(({ clipboard }) => clipboard.writeText("Shortcut text arrives."));
			await page.keyboard.press(
				process.platform === "darwin" ? "Meta+Shift+V" : "Control+Shift+V",
			);
			await expect(page.locator("main")).toContainText("Shortcut text arrives.");
		});

		await test.step("no CSP violations and no read-along text mismatch", async () => {
			// "offset drift" is not checked here: EpubViewer logs it for a moment on
			// any chapter switch (old chapter's HTML against the new one's chunks).
			const problems = consoleMessages.filter(
				(m) =>
					m.includes("Content Security Policy") || m.includes("plain text mismatch"),
			);
			expect(problems).toEqual([]);
		});
	} finally {
		await electronApp?.close().catch(() => {});
		rmSync(tempRoot, { recursive: true, force: true });
	}
});
