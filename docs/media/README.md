# README media

Screenshots used by the top-level `README.md`. They are **real app output**,
captured by driving the built Electron app with the bundled sample document.

## Regenerate

```bash
pnpm run build
# Linux CI / headless: xvfb-run --auto-servernum -- node e2e/capture-screenshots.mjs
# A machine with a display (incl. WSLg): DISPLAY=:0 node e2e/capture-screenshots.mjs
```

Writes `01-landing.png`, `02-reader.png`, `03-settings.png`, `04-reader-dark.png`
here.

## Demo video

GitHub hosts video directly: edit `README.md` on github.com, drag an `.mp4`
(≤100 MB, recorded **with system audio** so the voice is audible) into the
editor, and GitHub embeds a player. A silent `.gif` of the UI flow can live
here as a secondary option.
