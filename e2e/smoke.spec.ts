import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import {
	EPUB_BLOCK_TAGS,
	EPUB_SKIP_TAGS,
	EPUB_VOID_NO_TEXT_TAGS,
} from "../src/shared/epubHtmlPolicy";
import { htmlToPlainText } from "../src/shared/htmlPlainText";
import { sanitizeEpubHtml } from "../src/shared/sanitizeEpubHtml";
import { buildCrlfEpub, CHAPTER_ID, CHAPTER_XHTML } from "./fixtures/crlfEpub";

const REPO_ROOT = resolve(__dirname, "..");
const MAIN_BUNDLE = join(REPO_ROOT, "out", "main", "index.js");

/** Collapse all whitespace runs to single spaces (for tiling comparisons only). */
function collapseWs(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/**
 * Smoke: launch the *built* Electron app against a clean userData sandbox,
 * auto-open a CRLF-laced EPUB (via the persisted-session seam — the same
 * restore path a real user hits on relaunch), and verify the read-along
 * invariant that broke in v1.7.6: the plain text derived from the rendered
 * Chromium DOM must equal the shared htmlToPlainText output character for
 * character, or every TTS highlight after a CRLF drifts.
 *
 * No audio is synthesized (model weights are far too heavy for CI); instead we
 * assert the chunk structure that read-along playback maps onto.
 */
test("renders a CRLF EPUB chapter with intact read-along offsets", async () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "cross-tts-e2e-"));
	let electronApp: ElectronApplication | null = null;

	try {
		const epubPath = await buildCrlfEpub(join(tempRoot, "books"));

		// Seam for opening a book without driving the native file dialog: the app
		// restores `web.documentPath` from app-session.json on launch (see
		// src/mainview/features/reader/ReaderApp.tsx + src/bun/appSessionStore.ts).
		// CROSS_TTS_E2E_USER_DATA points userData at this sandbox dir.
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
					documentPath: epubPath,
					activeChapterId: CHAPTER_ID,
					currentChunkIndex: 0,
				},
			}),
		);

		electronApp = await _electron.launch({
			args: [
				MAIN_BUNDLE,
				// CI runners (and many containers) can't use the setuid sandbox.
				"--no-sandbox",
				"--disable-gpu",
			],
			env: {
				...process.env,
				CROSS_TTS_E2E_USER_DATA: userDataDir,
				// Never let a stray dev-server env redirect the window away from
				// the built renderer bundle.
				ELECTRON_RENDERER_URL: "",
			},
		});

		const page: Page = await electronApp.firstWindow();
		const consoleMessages: string[] = [];
		page.on("console", (msg) => consoleMessages.push(msg.text()));

		// The renderer computes the canonical TTS text from the *sanitized* HTML
		// the main process serves; mirror that exactly with the shared modules.
		const expectedCanonical = htmlToPlainText(sanitizeEpubHtml(CHAPTER_XHTML));
		expect(expectedCanonical).toContain("First sentence rendered");

		await test.step("chapter text renders", async () => {
			const body = page.locator(".epub-chapter-body");
			await expect(body).toBeVisible();
			await expect(body).toContainText("Chapter One");
			await expect(body).toContainText(
				"Closing words confirm the chapter really rendered to the end.",
			);
		});

		await test.step("DOM-derived plain text matches htmlToPlainText (offset integrity)", async () => {
			// Same walk as src/shared/domPlainTextPre.ts + finalizePlainText in
			// src/shared/htmlPlainText.ts, executed against the *real* Chromium DOM
			// (tag lists are passed in from the shared policy module).
			const domCanonical = await page.evaluate(
				({ blockTags, skipTags, voidTags }) => {
					const root = document.querySelector(".epub-chapter-body");
					if (!root) return null;
					let pre = "";
					const walk = (node: Node): void => {
						if (node.nodeType === Node.TEXT_NODE) {
							pre += node.textContent ?? "";
							return;
						}
						if (node.nodeType !== Node.ELEMENT_NODE) return;
						const tag = (node as Element).tagName.toLowerCase();
						if (skipTags.includes(tag)) return;
						if (tag === "br") {
							pre += "\n";
							return;
						}
						if (voidTags.includes(tag)) return;
						const isBlock = blockTags.includes(tag);
						if (isBlock) pre += " ";
						for (const child of (node as Element).childNodes) walk(child);
						if (isBlock) pre += "\n\n";
					};
					for (const child of root.childNodes) walk(child);
					// finalizePlainText (shared/htmlPlainText.ts), inlined verbatim.
					return pre
						.replace(/\r\n?/g, "\n")
						.replace(/[ \t]+\n/g, "\n")
						.replace(/\n{3,}/g, "\n\n")
						.replace(/[ \t]{2,}/g, " ")
						.trim();
				},
				{
					blockTags: [...EPUB_BLOCK_TAGS],
					skipTags: [...EPUB_SKIP_TAGS],
					voidTags: [...EPUB_VOID_NO_TEXT_TAGS],
				},
			);
			expect(domCanonical).toBe(expectedCanonical);
		});

		await test.step("read-along chunk structure maps onto the chapter text", async () => {
			// Chunk spans are the click-to-seek read-along elements the TTS engine
			// highlights; they must exist and tile the canonical text.
			const chunkSpans = page.locator('.epub-chapter-body span[role="button"]');
			await expect(chunkSpans.first()).toBeVisible();
			expect(await chunkSpans.count()).toBeGreaterThanOrEqual(2);

			const spanTexts = await chunkSpans.allTextContents();
			// First chunk starts at the start of the canonical text.
			expect(collapseWs(expectedCanonical).startsWith(collapseWs(spanTexts[0] ?? ""))).toBe(true);
			// Together the chunks cover the whole chapter (gaps are whitespace only).
			expect(collapseWs(spanTexts.join(" "))).toBe(collapseWs(expectedCanonical));
		});

		await test.step("the app's own offset self-checks stayed silent", async () => {
			// EpubViewer/epubHtmlRender warn on exactly the v1.7.6 failure mode.
			const offsetWarnings = consoleMessages.filter(
				(m) => m.includes("plain text mismatch") || m.includes("offset drift"),
			);
			expect(offsetWarnings).toEqual([]);
		});
	} finally {
		await electronApp?.close().catch(() => {});
		rmSync(tempRoot, { recursive: true, force: true });
	}
});
