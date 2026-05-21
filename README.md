# Cross TTS

Desktop text-to-speech reader built with [Electrobun](https://blackboard.sh/electrobun/) (Bun main process + system WebView), React, Tailwind, and Vite.

## Requirements

- [Bun](https://bun.sh/) (recommended for installs and scripts)

## Development

```bash
bun install
# Hot reload (Vite + Electrobun)
bun run dev:hmr
# Or bundle views and run Electrobun watch
bun run dev
```

## Production build

```bash
bun run build:stable
```

Outputs under `artifacts/` (and intermediate files under `build/`). `electrobun.config.ts` reads **`app.version` from `package.json`**, so you only bump the version in one place for releases.

### What each artifact is

| Artifact | Role |
|----------|------|
| `stable-*-*.zip` (Windows, Electrobun default) | Single download: unzip and run the included `…-Setup.exe` with the matching `.tar.zst` kept alongside it (Electrobun’s layout). The `.exe` alone is **not** enough without that archive. |
| `stable-*-*.tar.zst` | Compressed app bundle (used by the updater / installer path). |
| `stable-*-update.json` | Metadata for Electrobun’s update mechanism if you host releases yourself. |
| macOS `*.dmg` | Disk image when building on macOS (default Electrobun behavior). |

Electrobun does **not** ship one monolithic `.exe`; the Windows **zip** from `artifacts/` is the normal “one file to distribute” option.

## CI

GitHub Actions workflow **Build** runs on pushes and pull requests to `main` / `master`: installs Bun, runs `bun run build:stable` on Windows, Ubuntu, and macOS, and uploads `artifacts/` from each runner.

On Windows, CI patches icons into `*Setup.zip` with `rcedit` ([Electrobun #429](https://github.com/blackboardsh/electrobun/issues/429)) and builds an optional NSIS installer (`Cross-TTS-<version>-Setup.exe`). Local `bun run start` may still log icon embed warnings until upstream fixes the CLI.

## Releases (tag workflow)

1. Bump **`package.json`** `version` (and commit). `electrobun.config.ts` picks it up automatically.
2. Create an **annotated** tag whose name is `v` plus that exact version, for example `1.2.3` → tag `v1.2.3`.
3. Push the tag: `git push origin v1.2.3`.

The **Release** workflow runs on `v*` tags, checks that the tag (without `v`) equals `package.json`’s `version`, rebuilds on all three OSes, and publishes the contents of each `artifacts/` folder to the GitHub Release.

If the tag check fails, you likely tagged before bumping the version or used a mismatched tag name.

### Suggested commands

```bash
# Bump patch version, commit, and create tag vX.Y.Z in one step (npm CLI)
npm version patch -m "release v%s"
git push origin main && git push origin --tags
```

If you prefer to edit `package.json` by hand, use `git tag -a v1.0.1 -m "1.0.1"` after committing the version bump.

## Project layout

```
├── src/
│   ├── bun/index.ts          # Main process
│   └── mainview/             # React UI (Vite)
├── electrobun.config.ts
├── vite.config.ts
└── package.json
```

## Customizing

- **UI:** `src/mainview/`
- **Window / app shell:** `src/bun/index.ts`
- **App name, id, copy rules:** `electrobun.config.ts`
