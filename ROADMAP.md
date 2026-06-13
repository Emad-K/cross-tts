# Cross TTS — Improvement Roadmap

Status of recommended improvements. **Done** items shipped in this branch/release; **Planned** items list the exact files to touch and how to verify the effect, so they can be picked up one at a time.

---

## ✅ Done (this release)

### Releases auto-fire on a version bump
- **What:** `release.yml` now triggers on `push` to `main` (not on `v*` tags). A `detect` job releases only when `package.json`'s version has no matching `v<version>` tag yet; `publish` creates the tag via `gh release create --target <sha>`.
- **Why:** the old flow needed a separate manual `git tag` step. PR #75 merged to `main` and went green but shipped to no users because the tag was never cut. Now bumping the version in a merged PR *is* the release; no tag step to forget.
- **See the effect:** merge a PR that bumps `package.json` → a new GitHub Release appears within ~15 min. Merge one that doesn't → no release (tag already exists). Manual re-run: **Release** workflow → `workflow_dispatch`.

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

### 1. Inline-span word splitting (TTS pronunciation) — ✅ done (v1.8.6)
- **What:** inline (non-block) tags no longer emit a space in either plain-text path, so a tag glued inside a word (`<span>M</span>artial`, `str<span>o</span>ng`, drop-caps) is no longer read as two words. Block opens still add a space, block closes still add `\n\n`. `htmlToPlainText` now uses `BLOCK_START_TAG_PATTERN`→space then strips remaining (inline) tags to nothing; `buildDomPlainTextPre` only adds whitespace for block elements.
- **Verified:** byte-identical regex vs **real Chromium** DOM (139==139) on a chapter with drop-caps, mid-word spans, and nested inline tags; plus happy-dom alignment tests and new drop-cap unit tests.

### 2. Chunk pre-synthesis pipelining — ✅ done (N+1 pre-existed; N+2 added in v1.7.8)
- Single-chunk lookahead already existed in `runPlaybackLoop`. v1.7.8 deepens it to `PREFETCH_AHEAD = 2` so short chunks don't gap, and routes prefetch through the audio cache below.

### 3. Synthesized-audio cache — ✅ done (v1.7.8)
- **What:** `src/mainview/features/reader/tts/ttsAudioCache.ts` — a bounded (64) LRU with in-flight de-duplication, keyed by `voice/speed/rules-signature/text`. `synthesizeChunkBuffer` is now cache-aside; cleared on engine teardown (audio differs by device/reload).
- **See the effect:** seek back/forward or re-read a chunk → instant (no re-inference). The playback loop catching up to its own prefetch never double-synthesizes.

### 4. Library / recent books + per-book resume — ✅ done (v1.8.0, UI reworked v1.8.7)
- **What:** session gained an optional `books` map (path → {title, chapterId, chunkIndex, updatedAt}) in `src/shared/appSession.ts`, coerced in `src/bun/appSessionStore.ts` (back-compat: old sessions get `{}`). Pure helpers + tests in `src/shared/recentBooks.ts`. Reopening a book resumes via `openRecentBook` (a `forceResume` flag makes the saved position survive the document-change reset).
- **UI (v1.8.7):** an always-visible **Library** button in the header opens a `LibraryDialog` listing every opened book (current one marked "Reading"); selecting one reopens + resumes. Replaced the original "Recent" dropdown, which was hidden whenever the only book in history was the one being read — so a single-book user saw no entry point.
- **See the effect:** the **Library** button (top-right, next to Open file) — open it any time, while reading or on the start screen.
- **v1.8.8:** the **Library** button now simply closes the current book and returns to the **My-books home grid** (the dialog overlay was removed — you couldn't get back to the start page once a novel was open). Grid cards show **real EPUB cover art** (extracted from the epub via a `getBookCover` RPC, cached), falling back to the title-colored gradient when an epub has no cover or for .txt.

### 5. In-sentence progress sweep — ✅ done (v1.8.1)
- **Finding:** kokoro-js `generate_from_ids` returns only `{audio, sampling_rate}` — no per-token timestamps. True word-level karaoke is therefore impossible; only a duration-proportional estimate. Rather than mark a word that can drift off the audio, we sweep a subtle left-to-right fill across the active sentence (reads as intentional progress, not a mis-placed word).
- **What:** a transient `sweepStore` (separate from `useTtsStore` so 60fps updates don't starve the session-save debounce) is driven by `playBuffer` via `requestAnimationFrame` off the audio clock (`ctx.currentTime`, so pause freezes it for free). Viewers bind it to a `--sweep` CSS var on the active chunk element (imperative — no per-frame React re-render); the active chunk carries a gradient class (`SWEEP_CLASS`).
- **See the effect:** play any book — the active sentence fills left→right as its audio plays, in both the EPUB and TXT viewers.

### 6. Bookmarks — ✅ done (v1.8.5)
- **What:** session gained an optional `bookmarks` map (path → `Bookmark[]`, anchored by `chapterId`+`chunkIndex`). Pure helpers + tests in `src/shared/bookmarks.ts`. A bookmark button in the transport bar toggles the current spot and opens a menu of saved spots; selecting one jumps there (cross-chapter jumps reuse the `forceResume` path). Back-compat: old sessions get `{}`.
- **See the effect:** play to a spot, click the bookmark icon → "Bookmark this spot"; reopen the menu to jump between saved spots (and they persist across launches).

### 7. Audiobook export checkpointing — ✅ done (v1.8.2)
- **What:** the per-chapter output files are the checkpoint. `startExport` now checks `audioFileExists(dir, trackName)` (new RPC) before each chapter and skips re-synthesizing ones already written; their segments still count toward progress. The dialog shows "Resumed — skipped N already-exported chapters."
- **See the effect:** cancel/crash mid-export, restart into the same folder — finished chapters aren't re-synthesized. Delete the folder to force a fresh export.

### 8. CJK / pinyin pronunciation dictionary — ⏸ deferred (needs audio verification)
- **Why deferred:** `kokoroPhonemize` injects pronunciation-rule IPA **raw** into the phoneme stream (no re-phonemization), so a wrong IPA produces garbled audio — worse than eSpeak's guess. Short pinyin words (dan, li, yang, yin) also collide with English homographs under the whole-word match. A good pack therefore needs listening tests, which can't be done from the build pipeline.
- **Path forward:** the mechanism already exists — pronunciation rules are user-editable and import/export as JSON (`ttsRulesExchange`). Build a curated pinyin→IPA pack with audio QA, ship it as a (default-off) builtin rule group, and let users enable per-term. The single safe builtin (`qi → tʃiː`) stays.

### 9. Model warm-up state in UI — ✅ done (v1.8.3)
- **What:** `PlaybackControls` now shows a status line during the first-play wait — "Warming up voice model… N%" (model load/download) then "Preparing audio…" (first-sentence synthesis) — instead of a bare spinner.
- **See the effect:** press Play the first time after launch; the transport bar explains the pause.

### 10. O(n) rewrite of `buildPreToCanonicalMap` — ✅ done (v1.8.4)
- **What:** the map is now built in a single forward pass. A non-whitespace char always contributes one canonical char; a maximal whitespace run is finalized independently (no `finalizePlainTextInner` rule spans a non-ws↔ws boundary), so only the live trailing run is re-finalized — near-linear instead of O(n²).
- **Safety:** the naive O(n²) version is kept as a test oracle; `htmlPlainText.test.ts` asserts byte-identical `canonical` + `map` across fixtures and 400 random whitespace-heavy strings.
- **See the effect:** opening a long chapter no longer pays the quadratic cost (previously a noticeable hitch on large chapters even with the parse memoized).

---

## Notes
- The test suite runs on **happy-dom**, which differs from the renderer's **Chromium** (e.g. `\r` normalization). Any change to EPUB plain-text/offset code must be verified against real Chromium, not just `bun test`. See `src/shared/htmlPlainText.ts` history (v1.7.6).
