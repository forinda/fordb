# 01 — Desktop Framework Choice

Question: which shell for a lean, TS/JS-first, cross-platform DB client — Electron, Tauri, Wails, or Neutralino?

## Verified findings (2026-07)

### Bundle / install size — Tauri wins decisively

- Empty-app CI builds: Electron ~374MB build output (Win x64) / ~327MB (Linux x64) vs Tauri ~3–4MB, Wails ~8–11MB, Neutralino ~1MB. Note these are build-output comparisons; a typical Electron end-user installer is ~80–100MB. ([Elanis benchmark](https://github.com/Elanis/web-to-desktop-framework-comparison), CI-regenerated, verified 2026-07)
- Real apps: minimal Tauri app bundle 8.6MiB vs 244MiB Electron (~28x) ([Hopp](https://www.gethopp.app/blog/tauri-vs-electron)); production 2FA app Authme shipped ~2.5MB Tauri installer vs ~85MB Electron (~34x — 2022/Tauri v1 data; Tauri v2 installers typically 5–10MB, so 10–25x is the realistic range) ([Levminer](https://www.levminer.com/blog/tauri-vs-electron)).
- Tauri's small size depends on the OS-provided webview — the runtime isn't gone, just externalized.

### Memory — platform-dependent, Electron NOT always worst

- Windows x64 release builds: Electron ~275MB median (all processes) vs Tauri ~313MB and Wails ~316MB — WebView2 is itself Chromium-based. ([Elanis benchmark](https://github.com/Elanis/web-to-desktop-framework-comparison), corroborated by [tauri#5889](https://github.com/tauri-apps/tauri/issues/5889))
- macOS (WKWebView): Tauri's advantage is real — ~172MB vs ~409MB Electron with 6 windows (N=1, one MacBook Pro; don't generalize). ([Hopp](https://www.gethopp.app/blog/tauri-vs-electron))
- The common "30–50MB Tauri vs 200–300MB Electron" blog figures are unqualified marketing repetitions. Discard.

### Startup — Electron faster on Windows

- Windows x64 release: Electron ~183ms vs Tauri ~708ms, Wails ~599ms, NW.JS ~668ms — WebView2 cold-start cost. Single empty-app CI benchmark; an independent real-world comparison found startup differences negligible. Confidence: medium. ([Elanis benchmark](https://github.com/Elanis/web-to-desktop-framework-comparison))

### Rendering consistency — Electron wins

- Tauri uses each OS's native webview (WKWebView / WebView2 / WebKitGTK), so rendering varies across platforms and even Linux distros (documented divergences: CSS grid details, flexbox gap, WebGL levels, WebKitGTK version drift by distro). Electron's bundled Chromium renders identically everywhere. Materially relevant for a DB client's heavy grid/editor UI. ([Tauri webview versions](https://v2.tauri.app/reference/webview-versions/), [WRY](https://github.com/tauri-apps/wry), [Hopp](https://www.gethopp.app/blog/tauri-vs-electron))
- Community reports of Tauri Linux problems with WebKitGTK (performance, rendering bugs) recur in practitioner threads. Linux is a primary target for this project — weight this heavily.

### Language / runtime fit

- Electron: full Node.js in the main process → every Node DB driver (pg, better-sqlite3, mongodb) works natively, in-process. Pure TS/JS project.
- Tauri: backend is Rust; no Node runtime. DB drivers must be Rust crates (sqlx etc.) or a bundled Node sidecar process — either way the "pure TypeScript" property is lost (see doc 03).
- Wails: Go backend — same problem, different language.
- Neutralino: tiny but minimal ecosystem, no real native-module story for DB drivers.

## Assessment for forinda-db-client

| Criterion                    | Electron                    | Tauri                      |
| ---------------------------- | --------------------------- | -------------------------- |
| Bundle size                  | ~80–100MB installer         | ~5–10MB                    |
| Memory (Windows)             | ~equal                      | ~equal                     |
| Memory (macOS)               | worse                       | better                     |
| Startup (Windows)            | faster                      | slower                     |
| Rendering consistency        | identical everywhere        | varies per OS/distro       |
| Linux (primary target)       | solid                       | WebKitGTK pain points      |
| DB drivers in TS             | native, in-process          | Rust or sidecar workaround |
| Packaging all targets        | electron-builder            | built-in bundler           |
| Precedent (multi-DB clients) | Beekeeper Studio, Sqlectron | newer/smaller (dbx etc.)   |

**Recommendation: Electron.** Rationale:

1. User fluency is TS/JS — Electron keeps the entire stack (UI + DB drivers) in one language, one process model. Tauri forces Rust or a Node-sidecar hack precisely at the core of this app (database connectivity).
2. The only decisive Tauri win is installer size; for a developer tool installed once, 90MB is acceptable (DataGrip's complaint is UX bloat + memory, not download size — and Electron ties or wins on memory outside macOS).
3. Rendering consistency and Linux reliability matter for a grid-heavy UI on Debian/Arch targets.
4. Two direct precedents (Beekeeper Studio, Sqlectron) prove the exact product on this stack.

"Lean" must therefore be won at the app layer: CodeMirror over Monaco, virtualized grid, no bundled JDK/JVM-style baggage, fast cold start, small memory ceiling. Leanness is a product discipline, not a framework choice.

## Refuted / discarded claims

- Generic "Tauri is 4x faster to start" blog claims — unverifiable sources, contradicted by CI benchmark.
- "Tauri 30–50MB RAM" — marketing repetition without accounting methodology.
