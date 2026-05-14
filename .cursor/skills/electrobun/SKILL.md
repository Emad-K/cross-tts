---
name: electrobun
description: >-
  Guides Electrobun desktop apps (Bun + system WebView, typed RPC, views://,
  electrobun.config.ts). Use when the user works on Electrobun, BrowserWindow,
  BrowserView, Electroview, electrobun-webview, Tray, ApplicationMenu, IPC/RPC,
  app lifecycle, or electrobun.config.ts. Electrobun is not Electron—do not use
  Electron APIs or patterns.
disable-model-invocation: false
---

# Electrobun

Ultra-fast desktop framework: **Bun main process + system WebView** (not Chromium bundled like Electron). Docs: [blackboard.sh/electrobun](https://blackboard.sh/electrobun) · [llms.txt](https://blackboard.sh/electrobun/llms.txt) · [GitHub](https://github.com/blackboardsh/electrobun).

## Critical: Not Electron

| Topic | Wrong (Electron) | Right (Electrobun) |
|--------|------------------|---------------------|
| IPC | `ipcMain` / `ipcRenderer` | Typed `BrowserView.defineRPC` + `Electroview.defineRPC` |
| Webview tag | `<webview>` | `<electrobun-webview>` (OOPIF isolation) |
| Load UI | `file://` patterns | `views://…` for bundled views |
| Draggable titlebar | `-webkit-app-region` only | `electrobun-webkit-app-region-drag` / `no-drag` classes + `Electroview` in that view |

## CLI & layout

```bash
bunx electrobun init                    # templates: hello-world, photo-booth, interactive-playground, multitab-browser
bun install && bun start
bunx electrobun dev
bunx electrobun build [--env canary|stable] [--targets macos-arm64,win-x64,linux-x64,...]
```

Typical tree: `src/bun/index.ts` (main), `src/views/<name>/` (HTML/TS), `src/shared/types.ts` (RPC types), `electrobun.config.ts`, `icon.iconset/`.

## Imports

- Main (Bun): `import … from "electrobun/bun"` — e.g. `Electrobun`, `BrowserWindow`, `BrowserView`, `Tray`, `ContextMenu`, `ApplicationMenu`, `Updater`, `Utils`, `GlobalShortcut`, `Screen`, `Session`, `BuildConfig`, `PATHS`.
- Renderer: `import { Electroview } from "electrobun/view"`.

## `views://` scheme

Bundled UI and assets: `views://mainview/index.html`, preloads, tray images, `<script src="views://…">`. `PATHS.VIEWS_FOLDER` maps under resources; do not write to `PATHS.RESOURCES_FOLDER` (signing).

## BrowserWindow (essentials)

- `url: "views://…/index.html"` or `html: "…"`.
- `frame`, `titleBarStyle` (`default` | `hidden` | `hiddenInset`), `transparent`, `passthrough`.
- `preload`, `rpc`, `sandbox` (**sandbox true** → RPC off, events only).
- `renderer`: `"native"` | `"cef"` (CEF must be bundled for `cef`).
- `navigationRules`: string or null.
- Default webview: `win.webview` — `loadURL`, `loadHTML`, RPC, `setNavigationRules`, DevTools, find-in-page, download events, navigation events (`will-navigate` exposes `{ url, allowed }`).

## Typed RPC (Bun ↔ one webview)

1. **Shared** (`src/shared/types.ts`): `import { RPCSchema } from "electrobun/bun"` and define `MyRPCType` with `bun` and `webview` sides (`requests` with `params`/`response`, `messages` for fire-and-forget).
2. **Bun**: `const rpc = BrowserView.defineRPC<MyRPCType>({ maxRequestTime?, handlers: { requests, messages } })` → `new BrowserWindow({ …, rpc })`. Call renderer: `await win.webview.rpc.request.someWebviewFunction(…)`; send: `win.webview.rpc.send.…`. Optional catch-all messages: `"*": (name, payload) => …`.
3. **View**: `Electroview.defineRPC<MyRPCType>({ handlers })` then `new Electroview({ rpc })`. Call Bun: `await electroview.rpc.request.…`; send: `electroview.rpc.send.…`.

**No browser-to-browser RPC** — relay through Bun.

Built-in helper: `win.webview.rpc.request.evaluateJavascriptWithResponse({ script: "document.title" })`.

## Electroview & globals

Instantiate `Electroview` where you need RPC or **draggable regions**. Globals: `window.__electrobunWebviewId`, `window.__electrobunWindowId`.

## `<electrobun-webview>`

Embed isolated webviews: `src`, `partition`, `preload`, `sandbox` attribute. JS API: `loadURL`, back/forward/reload, `executeJavascript`, `setNavigationRules`, `on`/`off` (e.g. `dom-ready`, `did-navigate`, `new-window-open`, `host-message` with `__electrobunSendToHost` from preload).

## Tray / menus

- **Tray**: `new Tray({ title, image: "views://…", template?, width, height })`, `setMenu([{ type, label, action, submenu }])`, `on("tray-clicked", …)`.
- **ContextMenu**: `ContextMenu.showContextMenu([…])`; handle `Electrobun.events.on("context-menu-clicked", …)`.
- **ApplicationMenu**: `ApplicationMenu.setApplicationMenu([…])`; `Electrobun.events.on("application-menu-clicked", …)`. Roles include quit, hide, edit actions, fullscreen, window cycle — see docs for full list.

**Linux:** context menus and application menus **not supported** (per upstream docs).

## Utils, Screen, Session, shortcuts

- **Utils**: trash, reveal, `openExternal`, `openPath`, notifications, file dialog, message box, `quit()`, clipboard text/image, `Utils.paths.*` (OS dirs + app-scoped `userData` / `userCache` / `userLogs` by identifier + channel). macOS: `setDockIconVisible`.
- **GlobalShortcut**: `register` / `unregister` / `unregisterAll` — accelerators use `CommandOrControl`, `Alt`, etc.
- **Screen**: `getPrimaryDisplay`, `getAllDisplays`, `getCursorScreenPoint` (bounds + workArea + scaleFactor).
- **Session**: `Session.fromPartition("persist:…")` — cookies get/set/remove/clear, `clearStorageData`.

## Events & shutdown

- Global: `Electrobun.events.on("will-navigate", …)`, `"open-url"` (macOS deep link; app in `/Applications`), menu events, etc.
- Control propagation: `e.response = { allow: true|false }`, `e.clearResponse()`.
- **`before-quit`**: runs for `Utils.quit()`, `process.exit()`, last-window close, Cmd+Q, SIGINT/SIGTERM, updater restart — **async cleanup here**; cancel with `e.response = { allow: false }`. Prefer this over `process.on("beforeExit")` (does not run as expected in Electrobun). **Linux:** some system quit paths may not fire `before-quit`; use `Utils.quit()` / `process.exit()` when you must run handlers. Dev: first Ctrl+C graceful, second force; 10s timeout.

## `electrobun.config.ts` (satisfies `ElectrobunConfig`)

- **`app`**: `name`, `identifier`, `version`, `urlSchemes` (macOS deep links).
- **`runtime`**: e.g. `exitOnLastWindowClosed`; custom fields readable via `BuildConfig.get()`.
- **`build.bun`**: entrypoint + Bun.build pass-through (`plugins`, `external`, `sourcemap`, `minify`).
- **`build.views`**: map names → `{ entrypoint }`.
- **`build.copy`**: static files into `views/…` for `views://`.
- **`build.useAsar`**, **`asarUnpack`**, **`watch`**, **`watchIgnore`**, **`bunVersion`**.
- **Platform**: `mac` / `win` / `linux` — `codesign`, `notarize`, `bundleCEF`, `defaultRenderer` (`native` | `cef`), `icons`, `entitlements`, `chromiumFlags`. **Linux:** strongly recommend **CEF** (`bundleCEF: true`, `defaultRenderer: "cef"`). macOS/Windows can mix renderers per window; **Linux cannot mix**.
- **`scripts`**: `preBuild`, `postBuild`, `postWrap`, `postPackage` — env vars `ELECTROBUN_BUILD_ENV`, `ELECTROBUN_OS`, `ELECTROBUN_ARCH`, `ELECTROBUN_BUILD_DIR`, `ELECTROBUN_APP_*`, `ELECTROBUN_ARTIFACT_DIR`; `postWrap` also `ELECTROBUN_WRAPPER_BUNDLE_PATH`.
- **`release.baseUrl`**: updater base URL (was `bucketUrl` in older versions).

## Updater

`Updater.getLocalInfo()`, `Updater.checkForUpdate()`, `Updater.downloadUpdate()`, `Updater.applyUpdate()` (quit/replace/relaunch). Binary diff updates are small relative to full app reinstalls.

## Platforms (summary)

| OS | Webview default | Notes |
|----|-----------------|--------|
| macOS | WebKit | ARM64/x64 stable |
| Windows | WebView2 | x64 stable |
| Linux | WebKitGTK | Prefer CEF for consistency |

Optional CEF bundle on all platforms for Chromium parity.

## Patterns (quick)

- **Custom titlebar**: `titleBarStyle: "hidden"` / `"hiddenInset"`, optional `transparent`; HTML uses `electrobun-webkit-app-region-drag` / `no-drag`.
- **Multi-window**: track `win.id`, `win.on("close", …)`.
- **Untrusted web**: guest `<electrobun-webview sandbox partition="…">` + strict `setNavigationRules`.

When details are missing, prefer the canonical [llms.txt](https://blackboard.sh/electrobun/llms.txt) or project `electrobun` version types over guessing Electron behavior.
