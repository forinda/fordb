# M5 — v0.1 Release Pipeline (Design)

**Status:** approved (Linux + Windows; installers-first, updater deferred; incl. perf gate + AUR + winget), ready for plan
**Date:** 2026-07-10
**Milestone:** M5 (v0.1 release)

## Goal

Package the fordb Electron app into installable distributables (Linux deb + AppImage, Windows NSIS) and set up a tag-driven GitHub release pipeline that publishes them with checksums and updater metadata, plus a CI perf gate and secret-gated AUR/winget distribution. Exit: pushing `v0.1.0` produces a public GitHub Release with deb + AppImage + NSIS + `SHA256SUMS` + `latest*.yml`.

## Scope

### In (M5)

- **electron-builder config** — appId, targets (linux: AppImage+deb; win: nsis), asarUnpack for native deps, artifact naming.
- **`pnpm package`** local build (Linux) producing deb + AppImage.
- **`release.yml`** — tag `v*` → matrix build (ubuntu + windows) → `electron-builder --publish always` → draft GitHub Release → checksums finalize job → publish.
- **`latest*.yml`** generated (for a future updater to consume) — but **no** electron-updater in the app yet.
- **`perf.yml`** — cold-start + idle-RAM measurement via the Playwright harness, thresholds, README perf table.
- **AUR** (`fordb-bin` PKGBUILD) + **winget** manifest — release steps, secret-gated (skip cleanly without the secret).
- Version bump `0.0.1 → 0.1.0` + package.json metadata.

### Out (later)

- electron-updater in-app auto-update (focused follow-up; consumes the published `latest*.yml`).
- macOS dmg + code signing / notarization + Windows signing (M8).
- Flathub.

## Architecture

Existing: `pnpm build` = `electron-vite build` → `out/{main,preload,renderer}`; deps are externalized (stay in `node_modules`, required at runtime by the db-host `utilityProcess`). electron-builder packages `out/` + the pruned production `node_modules`.

### Packaging — `electron-builder.yml`

```yaml
appId: io.github.forinda.fordb
productName: fordb
directories:
  output: dist
  buildResources: build
files:
  - out/**
  - package.json
  - '!**/*.map'
# Native modules can't live inside the asar — unpack them so the db-host
# utilityProcess can dlopen/require them at runtime.
asarUnpack:
  - '**/*.node'
  - '**/node_modules/@libsql/**'
  - '**/node_modules/cpu-features/**'
  - '**/node_modules/ssh2/**'
npmRebuild: false # use the platform prebuilds fetched at install time; no node-gyp
publish:
  provider: github
  owner: forinda
  repo: fordb
linux:
  category: Development
  target: [AppImage, deb]
  artifactName: fordb-${version}-${arch}.${ext}
deb:
  artifactName: fordb_${version}_${arch}.deb
appImage:
  artifactName: fordb-${version}-${arch}.AppImage
win:
  target: [nsis]
  artifactName: fordb-${version}-setup.${ext}
nsis:
  oneClick: false
  perMachine: false # per-user install, no admin prompt
  allowToChangeInstallationDirectory: true
```

- **pure-JS deps** (`pg`, `mongodb`) bundle without special handling. **native deps** (`@libsql/client` prebuilds, `ssh2`→`cpu-features` `.node`) are asarUnpacked; `npmRebuild: false` uses the prebuilt binaries the package manager fetched for the runner's platform.
- **`build/` resources** — an app icon (`build/icon.png` 512×512 for Linux, `build/icon.ico` for Windows). A placeholder icon ships in M5; final art can replace it without config change.

### package.json

- `version: 0.1.0`; add `author`, `homepage: https://github.com/forinda/fordb`, `repository`.
- Scripts: `package: electron-vite build && electron-builder --linux`; `package:win: electron-vite build && electron-builder --win`; `package:all: electron-vite build && electron-builder -lw`.
- `electron-builder` + `@electron/notarize`(no) — just `electron-builder` devDep.

### Release workflow — `.github/workflows/release.yml`

Trigger: `on: { push: { tags: ['v*'] }, workflow_dispatch: {} }`.

- **`build` job (matrix `os: [ubuntu-latest, windows-latest]`)**: checkout → pnpm/node(22) → `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm exec electron-builder --${{ runner.os == 'Windows' && 'win' || 'linux' }} --publish always` with `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. electron-builder uploads the OS's artifacts to a **draft** release for the tag (auto-created, `releaseType: draft` via config or `--config.releaseType=draft`) and generates `latest-linux.yml` / `latest.yml` + `.blockmap`. On `workflow_dispatch` (no tag): `--publish never`, upload artifacts to the run instead (dry run).
- **`finalize` job (`needs: build`, ubuntu, tag only)**: `gh release download <tag>` → compute `sha256sum * > SHA256SUMS` → `gh release upload <tag> SHA256SUMS` → `gh release edit <tag> --draft=false` (publish). Uses `GITHUB_TOKEN`.
- **AUR step** (in `finalize`, `if: secrets.AUR_SSH_KEY != ''`): render `packaging/aur/PKGBUILD` with the version + AppImage `sha256`, push via `KSXGitHub/github-actions-deploy-aur`. Skips with a notice when the secret is absent.
- **winget step** (in `finalize`, `if: secrets.WINGET_TOKEN != ''`): submit `packaging/winget/*.yaml` via a komac action. Skips when absent.

### Perf gate — `.github/workflows/perf.yml`

Trigger: `on: { push: { branches: [main] }, workflow_dispatch: {} }`.

- ubuntu + `xvfb-run`; `pnpm install` + `pnpm build`; run `scripts/perf-measure.mjs` — launches the built app via Playwright `_electron.launch(['out/main/index.js'])`, waits for `firstWindow()` + a `window.fordb`-ready marker, records **cold-start ms** (spawn→ready) and **idle RSS MB** (main process, after a 3s settle), writes `perf-results.json` + a `$GITHUB_STEP_SUMMARY` line.
- **Thresholds** (soft, tunable): fail if cold-start > 4000ms or idle RSS > 400MB. Starting bars; adjusted once real numbers land.
- README carries a **Performance** table; the release finalize job (or a manual step) stamps the latest measured numbers. M5 seeds the table with the first CI measurement.

### AUR + winget packaging

- `packaging/aur/PKGBUILD` — `pkgname=fordb-bin`, `source` = the release `.AppImage`, `sha256sums` filled at release time, installs the AppImage to `/opt/fordb` + a `.desktop` entry. Deployed only when `AUR_SSH_KEY` is set (user provides an AUR account + maintainer key).
- `packaging/winget/io.github.forinda.fordb.installer.yaml` + `.locale.en-US.yaml` + version manifest — points at the release `setup.exe`; submitted only when `WINGET_TOKEN` is set (user provides a PAT + winget-pkgs fork).
- Both documented in `CONTRIBUTING.md`/`docs/` with the exact secret names + how to obtain them.

## Testing

- **Local:** `pnpm package` on Linux → `dist/*.AppImage` + `*.deb`; manually launch the AppImage, connect to Postgres/SQLite/Mongo (verifies the asarUnpacked native deps load in the packaged db-host). This is the primary M5 verification — CI can't fully prove the packaged app runs.
- **CI dry-run:** `workflow_dispatch` on `release.yml` (build both OSes, `--publish never`) before the real tag — proves the matrix + native rebuild + NSIS work without cutting a release.
- **Perf:** `perf.yml` green on `main` with numbers under threshold.
- **No new unit/e2e** — packaging is config; existing `ci.yml` stays the code gate.

## Risks

- **Native deps in the packaged db-host.** `@libsql/client`/`ssh2` must resolve their `.node`/prebuilds from the asarUnpacked path inside the packaged app. The local `pnpm package` + launch smoke is the guard; if a module fails to load, `asarUnpack` globs or the `files` include set needs widening. Highest-risk item.
- **NSIS on the Windows runner** — first Windows build may surface path/casing issues; the `workflow_dispatch` dry-run catches them pre-tag.
- **`latest*.yml` without an updater** — harmless (published, unconsumed); a later updater task wires electron-updater to read it.
- **AUR/winget secrets absent** — steps must `if:`-guard and no-op, never fail the release. A release must succeed with only `GITHUB_TOKEN`.
- **electron-builder + pnpm** — pnpm's symlinked `node_modules` can trip electron-builder; use `node-linker=hoisted` in `.npmrc` for the packaging install if needed (verify locally).

## Exit criteria

`pnpm package` builds a launchable deb + AppImage locally; a `workflow_dispatch` release dry-run builds all three installers on the matrix; pushing `v0.1.0` publishes a GitHub Release with deb + AppImage + NSIS + `SHA256SUMS` + `latest*.yml`; the perf gate is green with numbers in the README; AUR/winget fire when their secrets are configured.

## Task decomposition (for the plan)

1. **electron-builder config + local package** — `electron-builder.yml`, `build/` icon, package.json version/metadata/scripts, `.npmrc` hoist if needed; `pnpm package` → deb+AppImage; document the manual launch-smoke.
2. **release.yml (matrix build + draft)** — tag/dispatch trigger, ubuntu+windows matrix, `electron-builder --publish always/never`, draft release + `latest*.yml`.
3. **release.yml finalize (checksums + publish)** — SHA256SUMS job, publish-draft, gated AUR + winget steps + `packaging/` files.
4. **perf gate** — `scripts/perf-measure.mjs`, `perf.yml`, thresholds, README perf table.

## Self-review

1. **Coverage:** packaging (§Packaging, T1) · release matrix (§Release workflow, T2) · checksums/publish/AUR/winget (§Release/§AUR+winget, T3) · perf (§Perf gate, T4) · latest*.yml + updater-deferred (§Release) · version bump (§package.json, T1). All covered.
2. **Placeholders:** the electron-builder.yml + workflow shapes are concrete; icon is an explicit placeholder-now; thresholds are explicit starting values.
3. **Consistency:** `io.github.forinda.fordb` appId / `fordb` productName / `dist/` output / artifact-name patterns / `AUR_SSH_KEY`+`WINGET_TOKEN` secret names used consistently across packaging, release, and add-on sections.
4. **Ambiguity:** updater deferred (metadata only) is explicit; AUR/winget no-op-without-secret is explicit; Linux+Windows only (mac→M8) is explicit; perf numbers → README is stated.

**Deliberate deferrals:** electron-updater wiring, macOS dmg, all code signing/notarization (M8), Flathub.
