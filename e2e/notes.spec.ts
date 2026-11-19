import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { htmlToPlainText } from "../src/shared/htmlPlainText";
import { sanitizeEpubHtml } from "../src/shared/sanitizeEpubHtml";
import { buildCrlfEpub, CHAPTER_ID, CHAPTER_XHTML } from "./fixtures/crlfEpub";

const MAIN_BUNDLE = join(resolve(__dirname, ".."), "out", "main", "index.js");
const collapseWs = (s: string) => s.replace(/\s+/g, " ").trim();

/** Fire the reader's right-click menu at the middle of a DOM range. */
async function contextMenuAt(page: Page, highlight: string | null): Promise<void> {
	await page.evaluate((name) => {
		const range = name
			? [...(CSS.highlights.get(name) as unknown as Set<Range>)][0]!
			: window.getSelection()!.getRangeAt(0);
		const rect = range.getClientRects()[0]!;
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		document
			.elementFromPoint(x, y)!
			.dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true, clientX: x, clientY: y }),
			);
	}, highlight);
}

/**
 * Highlights, notes and a per-book pronunciation fix on a real Chromium DOM:
 * a selection crossing two read-along chunks must round-trip to chapter-text
 * offsets, be painted (CSS Custom Highlight API), listed, saved to notes.json
 * and painted again after a reload. No audio is synthesized.
 */
test("highlight, note and per-book pronunciation fix", async () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "cross-tts-e2e-notes-"));
	let electronApp: ElectronApplication | null = null;
	try {
		const epubPath = await buildCrlfEpub(join(tempRoot, "books"));
		const userDataDir = join(tempRoot, "user-data");
		mkdirSync(userDataDir, { recursive: true });
		const sessionPath = join(userDataDir, "app-session.json");
		writeFileSync(
			sessionPath,
			JSON.stringify({
				version: 1,
				window: null,
				maximized: false,
				fullScreen: false,
				web: { documentPath: epubPath, activeChapterId: CHAPTER_ID, currentChunkIndex: 0 },
			}),
		);
		electronApp = await _electron.launch({
			args: [MAIN_BUNDLE, "--no-sandbox", "--disable-gpu"],
			env: { ...process.env, CROSS_TTS_E2E_USER_DATA: userDataDir, ELECTRON_RENDERER_URL: "" },
		});
		const page = await electronApp.firstWindow();
		const canonical = htmlToPlainText(sanitizeEpubHtml(CHAPTER_XHTML));
		const notesPath = join(userDataDir, "notes.json");
		const savedNotes = () => {
			try {
				return JSON.parse(readFileSync(notesPath, "utf8")).byPath[epubPath] ?? [];
			} catch {
				return [];
			}
		};

		const chunks = page.locator(".epub-chapter-body [data-chunk-index]");
		await expect(chunks.nth(2)).toBeVisible();

		let selected = "";
		await test.step("highlight a selection that crosses two chunks", async () => {
			selected = await page.evaluate(() => {
				const spans = document.querySelectorAll(".epub-chapter-body [data-chunk-index]");
				const range = document.createRange();
				range.setStart(spans[1]!.firstChild!, 6);
				range.setEnd(spans[2]!.firstChild!, 17);
				const sel = window.getSelection()!;
				sel.removeAllRanges();
				sel.addRange(range);
				return range.toString();
			});
			expect(selected.length).toBeGreaterThan(20);

			await contextMenuAt(page, null);
			await page.getByRole("menuitem", { name: "Highlight green" }).click();

			const painted = await page.evaluate(() =>
				[...(CSS.highlights.get("note-green") as unknown as Set<Range>)].map((r) =>
					r.toString(),
				),
			);
			expect(painted).toEqual([selected]);

			await expect.poll(savedNotes).toHaveLength(1);
			const note = savedNotes()[0];
			expect(note.chapterId).toBe(CHAPTER_ID);
			expect(note.color).toBe("green");
			// Offsets index the same plain text the TTS engine reads.
			expect(canonical.slice(note.start, note.end)).toBe(note.text);
			expect(collapseWs(note.text)).toBe(collapseWs(selected));
		});

		await test.step("right-click the highlight to add a note", async () => {
			await contextMenuAt(page, "note-green");
			await expect(page.getByRole("menuitem", { name: "Remove highlight" })).toBeVisible();
			await page.getByRole("menuitem", { name: "Edit note…" }).click();
			await page.getByLabel("Note", { exact: true }).fill("Remember this bit");
			await page.getByRole("button", { name: "Save" }).click();
			await expect.poll(() => savedNotes()[0]?.note).toBe("Remember this bit");
			expect(await page.evaluate(() => CSS.highlights.has("note-noted"))).toBe(true);
		});

		await test.step("the Notes tab lists it", async () => {
			await page.getByRole("button", { name: "Show bookmarks" }).click();
			await page.getByRole("button", { name: /^Notes/ }).click();
			await expect(page.getByText("Remember this bit")).toBeVisible();
			await expect(page.getByRole("button", { name: "Export as Markdown" })).toBeEnabled();
		});

		await test.step("deleting from the list can be undone", async () => {
			await page.getByRole("button", { name: /^Delete highlight: / }).click();
			await expect.poll(savedNotes).toHaveLength(0);
			await page.getByRole("button", { name: "Undo" }).click();
			await expect.poll(() => savedNotes()[0]?.note).toBe("Remember this bit");
		});

		await test.step("Fix pronunciation…, limited to this book", async () => {
			await page.evaluate(() => {
				const node = document.querySelector(".epub-chapter-body [data-chunk-index]")!
					.firstChild!;
				const range = document.createRange();
				const at = node.textContent!.indexOf("Chapter");
				range.setStart(node, at);
				range.setEnd(node, at + "Chapter".length);
				const sel = window.getSelection()!;
				sel.removeAllRanges();
				sel.addRange(range);
			});
			await contextMenuAt(page, null);
			await page.getByRole("menuitem", { name: "Fix pronunciation…" }).click();
			await expect(page.getByLabel("Word")).toHaveValue("Chapter");
			// All books is the default; this book is one choice away.
			const scope = page.getByLabel("Applies to");
			await expect(scope).toHaveValue("");
			await page.getByLabel("Say it as").fill("chap-ter");
			await scope.selectOption(epubPath);
			await page.getByRole("button", { name: "Save" }).click();

			const bookRules = () =>
				(
					JSON.parse(readFileSync(sessionPath, "utf8")).web?.ttsTextRules?.regexRules ?? []
				).filter((r: { book?: string }) => r.book === epubPath);
			await expect.poll(bookRules, { timeout: 10_000 }).toHaveLength(1);
			expect(bookRules()[0].replacement).toBe("chap-ter");
		});

		await test.step("the menu works from the keyboard, on the focused sentence", async () => {
			await page.evaluate(() => window.getSelection()!.removeAllRanges());
			const sentence = chunks.last();
			await sentence.focus();
			await sentence.dispatchEvent("contextmenu", await sentence.evaluate((el) => {
				const r = el.getBoundingClientRect();
				return { bubbles: true, clientX: r.left + 2, clientY: r.top + 2 };
			}));
			await expect(page.getByRole("menuitem").first()).toBeFocused();
			await page.keyboard.press("ArrowDown");
			await expect(page.getByRole("menuitem", { name: "Highlight yellow" })).toBeFocused();
			await page.keyboard.press("Enter");
			await expect.poll(savedNotes).toHaveLength(2);
			expect(collapseWs(savedNotes()[1].text)).toBe(
				collapseWs((await sentence.textContent()) ?? ""),
			);
			// Focus goes back to where the menu was opened.
			await expect(sentence).toBeFocused();
		});

		await test.step("highlights come back after a reload", async () => {
			await page.reload();
			await expect(chunks.nth(2)).toBeVisible();
			await expect
				.poll(() =>
					page.evaluate(() =>
						[
							...((CSS.highlights.get("note-green") as unknown as Set<Range>) ?? []),
						].map((r) => r.toString()),
					),
				)
				.toEqual([selected]);
		});
	} finally {
		await electronApp?.close().catch(() => {});
		rmSync(tempRoot, { recursive: true, force: true });
	}
});
