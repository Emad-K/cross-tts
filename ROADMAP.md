# Cross TTS — Improvement Roadmap

Status of recommended improvements. **Done** items shipped in this branch/release; **Planned** items list the exact files to touch and how to verify the effect, so they can be picked up one at a time.

---

## ✅ Done (this release)

### CI runs the test suite
- **What:** `package.json` gains a `test` script; `.github/workflows/build.yml` and `release.yml` run `bun test` before building.
- **Why:** CI previously ran only `typecheck` + `build`. A failing assertion shipped in v1.7.5 and the CRLF highlight bug had no Chromium guard. Tests now gate every PR and release.
- **See the effect:** open any PR → the **Build** check now has a test step; a failing `bun test` blocks the merge. Locally: `bun test`.

### Release no longer ships `builder-debug.yml`
- **What:** upload globs in both workflows exclude `release/builder-debug.yml`.
- **See the effect:** next release's asset list (GitHub Releases page) — the stray `builder-debug.yml` is gone; `latest*.yml` auto-update manifests remain.

### GH Actions on Node 24
- **What:** `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` at workflow env level.
- **See the effect:** Actions run logs no longer show the "Node.js 20 actions are deprecated" annotation.

### EPUB read-along: parse/offset map memoized off the hot path
- **What:** `renderEpubHtmlWithReadAlong` split into `parseEpubReadAlong(html)` (DOM parse + `buildPreToCanonicalMap`, the O(n²) part — depends only on `html`) and `renderEpubReadAlong(parsed, props)` (per-tick React walk). `EpubViewer` memoizes the parse on `[html]`.
- **Why:** the map was rebuilt on **every chunk advance** (every highlight tick). Now it runs **once per chapter load**.
- **See the effect:** `src/mainview/features/reader/viewers/EpubViewer.tsx` + `epubHtmlRender.tsx`. Open a long chapter and play — chunk-to-chunk advance no longer re-parses the DOM. Profile: React commit time per chunk tick drops sharply on big chapters.

### TTS text normalization pass
- **What:** new `src/shared/ttsTextNormalize.ts`; wired into `textForTtsSynthesis` after rules. First, conservative rule: insert a space at digit↔letter boundaries (`6000jin` → `6000 jin`) so the phonemizer treats the number and word separately.
- **See the effect:** `src/shared/ttsTextNormalize.test.ts`; audibly, numbers glued to units (common in cultivation novels: `6000jin`, `5th`) read correctly.

---

## 🔜 Planned (file pointers + verification)

### 1. Inline-span word splitting (TTS pronunciation)
- **Problem:** inline tags add a space in both plain-text paths, so `<span>M</span>artial` → `"M artial"`; Kokoro says "M artial". Drop-caps and styled runs trigger this. (Consistent across paths, so no highlight drift — pure pronunciation.)
- **Touch:** `src/shared/htmlPlainText.ts` (`htmlToPlainText` generic `<[^>]+>`→space) and `src/shared/domPlainTextPre.ts` (`buildDomPlainTextPre` `pre += " "`). Only emit the space for **block** boundaries, not inline tags, when adjacent to word chars.
- **RISK:** changes offsets — both paths must stay byte-identical. **Verify in real Chromium** (Playwright: serve chapter, walk `document.body`, diff vs `htmlToPlainText`), plus a happy-dom alignment test with a drop-cap fixture.

### 2. Chunk pre-synthesis pipelining — ✅ done (N+1 pre-existed; N+2 added in v1.7.8)
- Single-chunk lookahead already existed in `runPlaybackLoop`. v1.7.8 deepens it to `PREFETCH_AHEAD = 2` so short chunks don't gap, and routes prefetch through the audio cache below.

### 3. Synthesized-audio cache — ✅ done (v1.7.8)
- **What:** `src/mainview/features/reader/tts/ttsAudioCache.ts` — a bounded (64) LRU with in-flight de-duplication, keyed by `voice/speed/rules-signature/text`. `synthesizeChunkBuffer` is now cache-aside; cleared on engine teardown (audio differs by device/reload).
- **See the effect:** seek back/forward or re-read a chunk → instant (no re-inference). The playback loop catching up to its own prefetch never double-synthesizes.

### 4. Library / recent books + per-book resume — ✅ done (v1.8.0)
- **What:** session gained an optional `books` map (path → {title, chapterId, chunkIndex, updatedAt}) in `src/shared/appSession.ts`, coerced in `src/bun/appSessionStore.ts` (back-compat: old sessions get `{}`). Pure helpers + tests in `src/shared/recentBooks.ts`. A "Recent" dropdown in `ReaderHeader` lists books; clicking reopens and resumes via `openRecentBook` (a `forceResume` flag makes the saved position survive the document-change reset).
- **See the effect:** open a few books, switch between them — each reopens from the **Recent** menu at its own saved chapter/chunk.

### 5. In-sentence progress sweep — ✅ done (v1.8.1)
- **Finding:** kokoro-js `generate_from_ids` returns only `{audio, sampling_rate}` — no per-token timestamps. True word-level karaoke is therefore impossible; only a duration-proportional estimate. Rather than mark a word that can drift off the audio, we sweep a subtle left-to-right fill across the active sentence (reads as intentional progress, not a mis-placed word).
- **What:** a transient `sweepStore` (separate from `useTtsStore` so 60fps updates don't starve the session-save debounce) is driven by `playBuffer` via `requestAnimationFrame` off the audio clock (`ctx.currentTime`, so pause freezes it for free). Viewers bind it to a `--sweep` CSS var on the active chunk element (imperative — no per-frame React re-render); the active chunk carries a gradient class (`SWEEP_CLASS`).
- **See the effect:** play any book — the active sentence fills left→right as its audio plays, in both the EPUB and TXT viewers.

### 6. Bookmarks / notes
- **Touch:** session schema + a sidebar panel; anchor by `(chapterId, chunkIndex)`.
- **See the effect:** jump-list of saved spots per book.

### 7. Audiobook export checkpointing — ✅ done (v1.8.2)
- **What:** the per-chapter output files are the checkpoint. `startExport` now checks `audioFileExists(dir, trackName)` (new RPC) before each chapter and skips re-synthesizing ones already written; their segments still count toward progress. The dialog shows "Resumed — skipped N already-exported chapters."
- **See the effect:** cancel/crash mid-export, restart into the same folder — finished chapters aren't re-synthesized. Delete the folder to force a fresh export.

### 8. CJK / pinyin pronunciation dictionary
- **Problem:** one-off pronunciation rules (`builtin-pron-qi`) don't scale; cultivation terms (qi, jin, dao, dantian) mispronounce.
- **Touch:** ship a curated pinyin→IPA map consumed by `kokoroPhonemize.ts`; expose as a toggotable rule group in the rules editor.
- **See the effect:** common terms pronounced correctly without per-user setup.

### 9. Model warm-up state in UI
- **Problem:** first GPU load (fp32) blocks first play with no signal beyond download.
- **Touch:** `ttsEngine.ts` already emits load phases; surface a "warming up model…" indicator in `PlaybackControls.tsx`.
- **See the effect:** first Play shows warm-up instead of an unexplained pause.

### 10. O(n) rewrite of `buildPreToCanonicalMap`
- **Problem:** currently O(n²) (re-finalizes every prefix). Memoization (done above) takes it off the hot path, but a single long chapter still pays O(n²) once.
- **Touch:** `src/shared/htmlPlainText.ts` — build the map in one forward pass that mirrors the four `finalizePlainTextInner` collapses with index tracking.
- **RISK:** must stay byte-exact vs the current implementation. Keep the O(n²) version as an oracle in tests (random fixtures, assert identical maps).

---

## Notes
- The test suite runs on **happy-dom**, which differs from the renderer's **Chromium** (e.g. `\r` normalization). Any change to EPUB plain-text/offset code must be verified against real Chromium, not just `bun test`. See `src/shared/htmlPlainText.ts` history (v1.7.6).
