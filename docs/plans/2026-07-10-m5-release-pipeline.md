# M5 — v0.1 Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package fordb into deb/AppImage/NSIS installers and set up a tag-driven GitHub release pipeline (matrix build → checksums → publish), a perf gate, and secret-gated AUR/winget distribution.

**Architecture:** `electron-vite build` → `out/`; `electron-builder` packages `out/` + pruned production `node_modules` (native deps `@libsql`/`ssh2`/`cpu-features` asarUnpacked, `npmRebuild:false` uses prebuilds). `release.yml` builds on ubuntu+windows runners and publishes a draft GitHub Release, finalized with `SHA256SUMS`. `perf.yml` measures cold-start + idle RAM via the Playwright harness.

**Tech Stack:** electron-builder, GitHub Actions (matrix), Playwright (`_electron`), pnpm, bash.

**Spec:** `docs/specs/2026-07-10-m5-release-pipeline-design.md`

## Global Constraints

- **Targets:** Linux `AppImage`+`deb`, Windows `nsis`. No macOS (M8). No code signing (M8).
- **appId** `io.github.forinda.fordb`; **productName** `fordb`; output dir `dist/`; repo `forinda/fordb`.
- **Native deps** asarUnpacked: `@libsql`, `ssh2`, `cpu-features`, all `*.node`; `npmRebuild: false`.
- **Updater deferred** — `latest*.yml` is published but no electron-updater in-app.
- **AUR/winget steps MUST no-op without their secrets** (`AUR_SSH_KEY`, `WINGET_TOKEN`); a release must succeed with only `GITHUB_TOKEN`.
- Version `0.1.0`. Perf thresholds: cold-start ≤ 4000ms, idle RSS ≤ 400MB (soft, tunable).
- Packaging is config — **no new unit/e2e tests**. Verify by local `pnpm package` launch-smoke + a `workflow_dispatch` release dry-run. `ci.yml` stays untouched.
- Per-task PR against `main`; prettier touched YAML/JSON/MD; commit trailers as usual.

## File Structure

- `electron-builder.yml` (CREATE) — packaging config.
- `build/icon.png` (CREATE) — 512×512 placeholder icon (Linux); `build/icon.ico` (CREATE) — Windows.
- `package.json` (MODIFY) — version, metadata, `package*` scripts, electron-builder devDep.
- `.npmrc` (CREATE, if needed) — `node-linker=hoisted` for packaging.
- `.github/workflows/release.yml` (CREATE) — matrix build + finalize.
- `packaging/aur/PKGBUILD` (CREATE), `packaging/winget/*.yaml` (CREATE).
- `scripts/perf-measure.mjs` (CREATE), `.github/workflows/perf.yml` (CREATE).
- `README.md` (MODIFY) — status line + Performance table.

---

### Task 1: electron-builder config + local package

**Files:** Create `electron-builder.yml`, `build/icon.png`, `build/icon.ico`, `.npmrc`. Modify `package.json`.

**Produces:** `pnpm package` → `dist/fordb-0.1.0-x64.AppImage` + `dist/fordb_0.1.0_amd64.deb`.

- [ ] **Step 1: Add electron-builder + a placeholder icon.**

```bash
pnpm add -D electron-builder
# 512x512 placeholder PNG (solid Dialect navy) — replace with real art later.
mkdir -p build
node -e "const z=require('zlib');const w=512,h=512;const px=Buffer.alloc(w*h*4);for(let i=0;i<w*h;i++){px[i*4]=15;px[i*4+1]=33;px[i*4+2]=64;px[i*4+3]=255;}const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;px.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(z.crc32?z.crc32(b):require('zlib').crc32(b));return Buffer.concat([l,b,c]);}" 2>/dev/null || true
```

If the inline PNG generator is awkward, instead create `build/icon.png` with ImageMagick (`convert -size 512x512 xc:'#0f2140' build/icon.png`) or commit any 512×512 PNG. For Windows, `convert build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico`. The icon just needs to exist and be valid; art is a later swap.

- [ ] **Step 2: Create `electron-builder.yml`:**

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
asarUnpack:
  - '**/*.node'
  - '**/node_modules/@libsql/**'
  - '**/node_modules/cpu-features/**'
  - '**/node_modules/ssh2/**'
npmRebuild: false
publish:
  provider: github
  owner: forinda
  repo: fordb
linux:
  category: Development
  icon: build/icon.png
  target:
    - AppImage
    - deb
appImage:
  artifactName: fordb-${version}-${arch}.AppImage
deb:
  artifactName: fordb_${version}_${arch}.deb
win:
  icon: build/icon.ico
  target:
    - nsis
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  artifactName: fordb-${version}-setup.${ext}
```

- [ ] **Step 3: Update `package.json`** — version + metadata + scripts:

```jsonc
  "version": "0.1.0",
  "author": "forinda",
  "homepage": "https://github.com/forinda/fordb",
  "repository": { "type": "git", "url": "https://github.com/forinda/fordb.git" },
  // in "scripts":
  "package": "pnpm build && electron-builder --linux",
  "package:win": "pnpm build && electron-builder --win",
  "package:all": "pnpm build && electron-builder -lw"
```

- [ ] **Step 4: `.npmrc`** — electron-builder needs a real (hoisted) node_modules layout to prune production deps; pnpm's symlinks trip it:

```
node-linker=hoisted
```

Reinstall so the layout applies: `pnpm install`.

- [ ] **Step 5: Build the installers locally.** `pnpm package`. Expected: `dist/` contains `fordb-0.1.0-x64.AppImage` and `fordb_0.1.0_amd64.deb` (+ `latest-linux.yml`, `.blockmap`). If electron-builder errors on a native dep, widen `asarUnpack`/`files` and re-run.

- [ ] **Step 6: Launch-smoke (manual, documented).** `./dist/fordb-0.1.0-x64.AppImage` (or `--appimage-extract-and-run` if FUSE missing) → the window opens, create a SQLite connection, run a query, see rows. This proves the asarUnpacked `@libsql` loads inside the packaged db-host. Note the result in the PR body. (Cannot be automated in CI reliably — the packaged app needs a display + FUSE.)

- [ ] **Step 7: Commit.** Branch `m5-t1-builder`; `feat: electron-builder packaging (deb + AppImage) (M5 T1)`. Add `dist/` to `.gitignore`. PR, merge.

---

### Task 2: Release workflow — matrix build

**Files:** Create `.github/workflows/release.yml`.

**Produces:** on a `v*` tag, a **draft** GitHub Release with the OS's artifacts + `latest*.yml`.

- [ ] **Step 1: Create `.github/workflows/release.yml`:**

```yaml
name: release
on:
  push:
    tags: ['v*']
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Build + package (publish on tag, dry-run otherwise)
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        shell: bash
        run: |
          FLAG=$([ "${{ github.ref_type }}" = "tag" ] && echo always || echo never)
          if [ "${{ runner.os }}" = "Windows" ]; then TARGET=--win; else TARGET=--linux; fi
          pnpm build
          pnpm exec electron-builder $TARGET --publish $FLAG --config.releaseType=draft
      - name: Upload artifacts (dry-run visibility)
        if: github.ref_type != 'tag'
        uses: actions/upload-artifact@v4
        with:
          name: installers-${{ matrix.os }}
          path: |
            dist/*.AppImage
            dist/*.deb
            dist/*.exe
            dist/*.yml
          if-no-files-found: ignore
```

- [ ] **Step 2: Verify with a dry-run.** After merge, trigger `release.yml` via the Actions tab (`workflow_dispatch`). Expected: both matrix legs green; `installers-ubuntu-latest` (AppImage+deb+yml) and `installers-windows-latest` (setup.exe+yml) uploaded as run artifacts; no release created (publish=never on non-tag). If the Windows leg fails on a native dep, note the error for the fix.

- [ ] **Step 3: Commit.** Branch `m5-t2-release-build`; `ci: release.yml matrix build (ubuntu + windows) (M5 T2)`. PR, merge.

---

### Task 3: Release finalize — checksums, publish, AUR, winget

**Files:** Modify `.github/workflows/release.yml`. Create `packaging/aur/PKGBUILD`, `packaging/winget/io.github.forinda.fordb.installer.yaml`, `packaging/winget/io.github.forinda.fordb.locale.en-US.yaml`, `packaging/winget/io.github.forinda.fordb.yaml`.

**Consumes:** the draft release + artifacts from T2.

- [ ] **Step 1: Add the `finalize` job** to `release.yml` (runs only on a real tag, after both builds):

```yaml
finalize:
  needs: build
  if: github.ref_type == 'tag'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Checksums
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: |
        mkdir sums && cd sums
        gh release download "${GITHUB_REF_NAME}" --repo "${GITHUB_REPOSITORY}" \
          --pattern '*.AppImage' --pattern '*.deb' --pattern '*.exe'
        sha256sum * > SHA256SUMS
        gh release upload "${GITHUB_REF_NAME}" SHA256SUMS --repo "${GITHUB_REPOSITORY}" --clobber
    - name: Publish the release
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: gh release edit "${GITHUB_REF_NAME}" --repo "${GITHUB_REPOSITORY}" --draft=false
    - name: Publish to AUR
      if: ${{ secrets.AUR_SSH_KEY != '' }}
      uses: KSXGitHub/github-actions-deploy-aur@v3
      with:
        pkgname: fordb-bin
        pkgbuild: packaging/aur/PKGBUILD
        commit_username: fordb-ci
        commit_email: ci@fordb.dev
        ssh_private_key: ${{ secrets.AUR_SSH_KEY }}
        commit_message: 'Update to ${{ github.ref_name }}'
    - name: Submit to winget
      if: ${{ secrets.WINGET_TOKEN != '' }}
      run: |
        echo "winget submission would run here (komac) with the release setup.exe"
        # komac update io.github.forinda.fordb --version "${GITHUB_REF_NAME#v}" \
        #   --urls "https://github.com/${GITHUB_REPOSITORY}/releases/download/${GITHUB_REF_NAME}/fordb-${GITHUB_REF_NAME#v}-setup.exe" \
        #   --token "${{ secrets.WINGET_TOKEN }}" --submit
```

> The winget step is a documented placeholder-with-real-command (commented) because a live submission needs a maintainer PAT + fork; the `if:` guard keeps it inert without the secret. AUR uses the real action, also guarded.

- [ ] **Step 2: `packaging/aur/PKGBUILD`** (`fordb-bin`, extracts the AppImage):

```bash
# Maintainer: forinda
pkgname=fordb-bin
pkgver=0.1.0
pkgrel=1
pkgdesc="Lean, keyboard-first, multi-engine desktop database client"
arch=('x86_64')
url="https://github.com/forinda/fordb"
license=('MIT')
provides=('fordb')
conflicts=('fordb')
options=(!strip)
source=("fordb-${pkgver}.AppImage::https://github.com/forinda/fordb/releases/download/v${pkgver}/fordb-${pkgver}-x64.AppImage")
sha256sums=('SKIP')
package() {
  install -Dm755 "fordb-${pkgver}.AppImage" "${pkgdir}/opt/fordb/fordb.AppImage"
  install -dm755 "${pkgdir}/usr/bin"
  ln -s /opt/fordb/fordb.AppImage "${pkgdir}/usr/bin/fordb"
}
```

- [ ] **Step 3: winget manifests** — `packaging/winget/io.github.forinda.fordb.yaml` (version), `.installer.yaml` (points at the release `setup.exe`, `InstallerType: nsis`, `Scope: user`), `.locale.en-US.yaml` (name/publisher/description/license MIT/homepage). Fill `PackageVersion: 0.1.0`, `InstallerUrl` templating the release URL, `InstallerSha256` left as a release-time fill note. These are the source of truth a submission action reads.

- [ ] **Step 4: Verify.** Re-run the `workflow_dispatch` dry-run — the `finalize` job is skipped (not a tag), confirming the tag-gate. The full path is exercised only by a real tag (Task-end note: the first real `v0.1.0` tag is the milestone exit, done deliberately after review).

- [ ] **Step 5: Commit.** Branch `m5-t3-finalize`; `ci: release finalize — checksums, publish, gated AUR + winget (M5 T3)`. PR, merge.

---

### Task 4: Perf gate

**Files:** Create `scripts/perf-measure.mjs`, `.github/workflows/perf.yml`. Modify `README.md`.

- [ ] **Step 1: `scripts/perf-measure.mjs`** — launch the built app, measure cold-start + idle RSS:

```js
import { _electron as electron } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

const COLD_START_MAX_MS = 4000
const IDLE_RSS_MAX_MB = 400

const t0 = Date.now()
const app = await electron.launch({
  args: ['out/main/index.js'],
  env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
})
const win = await app.firstWindow()
await win.waitForFunction(() => typeof window.fordb !== 'undefined', null, { timeout: 15000 })
const coldStartMs = Date.now() - t0

await new Promise((r) => setTimeout(r, 3000)) // settle
const pid = app.process().pid
const rssKb = Number(
  readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1] ?? '0'
)
const idleRssMb = Math.round(rssKb / 1024)
await app.close()

const result = { coldStartMs, idleRssMb, at: new Date().toISOString() }
writeFileSync('perf-results.json', JSON.stringify(result, null, 2))
console.log(`cold start: ${coldStartMs} ms | idle RSS: ${idleRssMb} MB`)
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### fordb perf\n\n| metric | value | budget |\n| --- | --- | --- |\n| cold start | ${coldStartMs} ms | ${COLD_START_MAX_MS} ms |\n| idle RSS | ${idleRssMb} MB | ${IDLE_RSS_MAX_MB} MB |\n`,
    { flag: 'a' }
  )
}
if (coldStartMs > COLD_START_MAX_MS || idleRssMb > IDLE_RSS_MAX_MB) {
  console.error('perf budget exceeded')
  process.exit(1)
}
```

- [ ] **Step 2: `.github/workflows/perf.yml`:**

```yaml
name: perf
on:
  push:
    branches: [main]
  workflow_dispatch: {}
jobs:
  perf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - run: xvfb-run -a node scripts/perf-measure.mjs
      - uses: actions/upload-artifact@v4
        with: { name: perf-results, path: perf-results.json }
```

- [ ] **Step 3: Run it locally.** `pnpm build && xvfb-run -a node scripts/perf-measure.mjs` (or without xvfb on a desktop). Expected: prints `cold start: … ms | idle RSS: … MB`, writes `perf-results.json`, exits 0 if under budget. Record the real numbers.

- [ ] **Step 4: README Performance table.** Update the status line ("No packaged installers…" → point at Releases once tagged) and add:

```markdown
## Performance

Measured in CI (`perf.yml`, headless Linux) on each `main` push:

| metric     | value            | budget  |
| ---------- | ---------------- | ------- |
| cold start | <from step 3> ms | 4000 ms |
| idle RSS   | <from step 3> MB | 400 MB  |
```

Fill the values from Step 3.

- [ ] **Step 5: Commit.** Branch `m5-t4-perf`; `ci: perf gate — cold-start + idle-RSS measurement (M5 T4)`. Add `perf-results.json` to `.gitignore`. PR, merge.

_*End of M5 — the pipeline is in place. Cutting the real `v0.1.0` tag (the exit criterion) is a deliberate post-review step: bump nothing further, push the tag, confirm the published Release has deb + AppImage + NSIS + SHA256SUMS + latest*.yml._*

## Self-Review

1. **Spec coverage:** electron-builder + local package (§Packaging → T1); release matrix (§Release workflow → T2); checksums/publish/AUR/winget (§Release/§AUR+winget → T3); perf (§Perf gate → T4); latest*.yml + updater-deferred (T2 note); version bump + metadata (T1). All covered.
2. **Placeholder scan:** the winget live-submit is an intentional guarded placeholder (needs a maintainer PAT) — flagged as such, inert without the secret, not a plan gap. Icon is an explicit placeholder-now. Everything else is concrete code.
3. **Consistency:** `io.github.forinda.fordb` / `fordb` / `dist/` / `forinda/fordb` / artifact patterns (`fordb-${version}-${arch}.AppImage`, `fordb-${version}-setup.exe`) / secret names (`AUR_SSH_KEY`, `WINGET_TOKEN`) / thresholds (4000ms, 400MB) identical across tasks.

**Deliberate deferrals:** electron-updater wiring, macOS dmg, all signing/notarization (M8), Flathub, real app icon.
