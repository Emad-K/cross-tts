# Cross TTS

**Turn any book into an audiobook — fully offline, on your own machine.**

Cross TTS is a free desktop reader that speaks your EPUB and TXT files with natural, neural text-to-speech ([Kokoro](https://github.com/hexgrad/kokoro)). No account, no cloud, no subscription: the voice model runs locally, so nothing you read ever leaves your computer.

[**⬇ Download the latest release**](https://github.com/Emad-K/cross-tts/releases/latest) — Windows · macOS · Linux

---

## Why you might like it

- **Real audiobook feel** — sentence-by-sentence read-along highlighting, a media-player bar with elapsed/total chapter time, and OS media-key support (play/pause from your keyboard or headphones).
- **Completely offline & private** — the TTS model is downloaded once and cached locally. Airplane mode works fine.
- **It remembers everything** — your library tracks covers, reading progress, tags, and bookmarks; reopening a book resumes exactly where you stopped.
- **Export audiobooks** — render a whole book to **M4B** (with chapter markers and cover art) or MP3 and listen on your phone.
- **Built for long reads** — sleep timer (by time or end-of-chapter), playback speed 0.75–2×, adjustable pause between sentences, and a 28-voice picker.
- **Comfortable reading** — five themes, seven fonts including OpenDyslexic, adjustable layout, in-chapter find (Ctrl+F), and a right-click menu with copy and dictionary lookup.
- **Niche but handy** — watched folders that auto-import new books, custom pronunciation rules, and an optional pinyin pack for xianxia/wuxia terms.
- **GPU-accelerated** — synthesis runs on WebGPU when available, with automatic CPU fallback.

## Features at a glance

| | |
|---|---|
| Formats | EPUB, TXT |
| Voices | 28 Kokoro voices, English |
| Playback | Read-along highlight, speed control, sentence pause, sleep timer, media keys |
| Library | Covers, progress, tags, search/sort, watched folders |
| Export | M4B (chapters + cover), MP3 |
| Platforms | Windows (installer + portable), macOS (x64 / Apple Silicon), Linux (AppImage / deb / rpm) |
| Privacy | 100% local synthesis, no telemetry of your content |

## Installation

Grab the build for your OS from the [releases page](https://github.com/Emad-K/cross-tts/releases/latest):

- **Windows:** `cross-tts-<version>-x64.exe` (NSIS installer) or the portable `.exe`
- **macOS:** `.dmg` (x64 or arm64)
- **Linux:** AppImage, `.deb`, or `.rpm` (x64 or arm64)

On first play the app downloads the compact Kokoro voice model and caches it; after that it works offline. Updates are delivered in-app via GitHub releases.

## Development

Built with Electron, React, TypeScript, Tailwind, and Vite (electron-vite). TTS is [kokoro-js](https://github.com/hexgrad/kokoro) running on ONNX Runtime in a Web Worker.

```bash
pnpm install
pnpm run dev        # hot-reload dev app
pnpm run typecheck  # tsc --noEmit
pnpm run test       # unit tests (bun test)
pnpm run test:e2e   # Playwright smoke tests against the built app
pnpm run build      # production build
pnpm run dist       # package installers (or dist:win / dist:mac / dist:linux)
```

### Project layout

```
src/
├── bun/        # Electron main process (file I/O, model cache, updates, IPC)
├── preload/    # context-isolated IPC bridge
├── mainview/   # React renderer (reader, library, playback, settings)
└── shared/     # pure logic shared across processes (unit-tested with bun)
e2e/            # Playwright tests against the packaged app
```

### Releasing

1. Bump `version` in `package.json` and commit.
2. Tag it `v<version>` (annotated) and push the tag.
3. The **Release** workflow verifies the tag matches `package.json`, builds all three OSes, and publishes the artifacts.

## Contributing

Issues and PRs welcome. CI runs typecheck, unit tests, a three-OS build, and Playwright smoke tests on every PR — `pnpm run build:check && pnpm run test` locally gets you most of the way.
