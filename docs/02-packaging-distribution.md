# 02 — Multi-Platform Packaging & Distribution

Question: how to build .deb (Debian), Arch packages, Windows installers, AppImage (+ optional macOS dmg) from one codebase, with CI/CD.

## Verified findings (2026-07)

### electron-builder (primary path if Electron chosen)
- One GitHub Actions workflow with a matrix over `[ubuntu-latest, windows-latest, macos-latest]` builds all three platforms — no per-OS pipelines. ([electron-builder GitHub Actions docs](https://www.electron.build/docs/features/github-actions/))
- Publishing: the automatic `GITHUB_TOKEN` (exposed as `GH_TOKEN`) authorizes uploads; `--publish always` on a version-tag push uploads installers to the matching GitHub Release automatically. Needs `permissions: contents: write`; a nonexistent release is created as a draft.

Linux target status ([electron-builder Linux docs](https://www.electron.build/docs/linux/)):

| Target | Status |
|---|---|
| AppImage | First-class, default target, "best first choice" |
| snap | First-class, also built by default |
| deb | First-class (built via fpm) |
| rpm | First-class (fpm) |
| pacman | Supported but **beta** — "test thoroughly before distributing" |
| flatpak | Target exists, but Flathub distribution goes through a Flathub-side manifest instead |

Gotchas:
- **AppImage + FUSE2**: default AppImage toolset depends on libfuse2, deprecated/absent on Ubuntu 24.04+, Fedora, Arch (`dlopen(): error loading libfuse.so.2`). Fix: `toolsets: { appimage: "1.0.3" }` — static runtime, no FUSE2, becomes default in electron-builder v27. ([AppImage docs](https://www.electron.build/docs/appimage/))
- deb/rpm/pacman built via fpm — set `maintainer` and `category`; missing `desktopName` breaks window–launcher association on GNOME/KDE.
- Linux + Windows(wine) can cross-build in the `electronuserland/builder` Docker image, but macOS dmg requires a macOS runner — matrix stays 3 runners.

### Tauri bundler (if Tauri chosen)
- Bundling is built into the CLI: single `tauri build` produces platform installers via `bundle.targets`. Full BundleType enum: `deb, rpm, appimage, msi, nsis, app, dmg` — on Linux that's **deb + rpm + AppImage only**. NSIS toolchain auto-downloaded. ([Tauri distribute docs](https://v2.tauri.app/distribute/), [config reference](https://v2.tauri.app/reference/config/#bundleconfig))
- **No cross-compilation**: each OS's installers must be built on that OS — CI matrix required either way.
- Snap/AUR: official guides exist but are fully manual (hand-written snapcraft.yaml / PKGBUILD over the released .deb). Flatpak guide is `draft: true` and unpublished — community territory.
- Tauri updater: Linux support is **AppImage only**; deb/rpm rely on package managers.

### Arch / AUR pipeline (either framework)
Two established patterns ([ArchWiki Electron guidelines](https://wiki.archlinux.org/title/Electron_package_guidelines)):
1. **`-bin` repack** (most vendors): PKGBUILD sources the released `.deb`, extracts with bsdtar. Examples: `beekeeper-studio-bin`, `visual-studio-code-bin`. Per release: bump `pkgver` + `sha256sums`, regen `.SRCINFO`, push.
2. **Source build against system Electron** (Arch's preferred style): ship only `app.asar`, depend on `electronNN` package.

Automation: **[KSXGitHub/github-actions-deploy-aur](https://github.com/KSXGitHub/github-actions-deploy-aur)** — templated PKGBUILD + AUR SSH key; runs as a job after release, pushes to AUR automatically. Practical pipeline: `.deb` to GitHub Releases → sed version+sha into PKGBUILD template → action pushes to AUR on tag.

### Flatpak / Flathub (Electron)
- Official path: `base: org.electronjs.Electron2.BaseApp` manifest on Flathub's own build infra (no network at build time — extract released .deb or pre-generate npm deps). Moderate effort, separate artifact pipeline. ([Flatpak Electron guide](https://docs.flatpak.org/en/latest/electron.html))
- Worth it as **secondary** channel (default store on Fedora/GNOME); not primary (sandbox, review, no in-app updater).
- Beekeeper's own ranking: AppImage first ("super easy... no accounts/signing"), then Snap, then deb; hosted apt/rpm repos "not really worth it". ([Beekeeper blog](https://www.beekeeperstudio.io/blog/distribute-electron-apps-for-linux))

### Auto-update per format
| Format | electron-updater | Tauri updater |
|---|---|---|
| AppImage | ✅ default | ✅ (only Linux format) |
| deb / rpm | ✅ (since electron-builder v24) | ❌ package manager |
| pacman | ✅ beta | ❌ |
| snap / flatpak / AUR | ❌ store/repo-managed | ❌ store/repo-managed |

`--publish always` also uploads `latest-linux.yml` etc. — the metadata electron-updater polls. ([auto-update docs](https://www.electron.build/docs/features/auto-update/))

### Reference release workflow (electron-builder)
```yaml
name: release
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      # build config: linux { target: [deb, AppImage], maintainer, category },
      # toolsets { appimage: "1.0.3" }, win { target: nsis }, mac { target: dmg },
      # publish { provider: github }
      - run: npx electron-builder --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  aur:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Generate PKGBUILD from template
        run: |
          VER="${GITHUB_REF_NAME#v}"
          DEB_URL="https://github.com/${{ github.repository }}/releases/download/v${VER}/forinda-db-client_${VER}_amd64.deb"
          SHA=$(curl -sL "$DEB_URL" | sha256sum | cut -d' ' -f1)
          sed -e "s/@VER@/${VER}/" -e "s/@SHA@/${SHA}/" \
              packaging/aur/PKGBUILD.tpl > packaging/aur/PKGBUILD
      - uses: KSXGitHub/github-actions-deploy-aur@v4
        with:
          pkgname: forinda-db-client-bin
          pkgbuild: packaging/aur/PKGBUILD
          commit_username: release-bot
          commit_email: forinda82@gmail.com
          ssh_private_key: ${{ secrets.AUR_SSH_PRIVATE_KEY }}
          commit_message: "Update to ${{ github.ref_name }}"
```

### Code signing — effectively mandatory for public distribution
- macOS: Apple "Developer ID Application" certificate + notarization required for apps outside the App Store (macOS 10.15+; Sequoia removed the Control-click bypass — users must go through System Settings → "Open Anyway" + admin auth). ([Apple Developer ID](https://developer.apple.com/developer-id/), [Electron code-signing docs](https://www.electronjs.org/docs/latest/tutorial/code-signing))
- Windows: SmartScreen blocks/warns on unsigned executables until reputation builds. "Prevent" overstates it — user override exists, but friction is high for non-developers.
- Cloud-based signing services (provider-hosted signing hardware) are the Electron-maintainer-favored CI approach; Electron's own apps use DigiCert KeyLocker. ([electron-builder code-signing docs](https://www.electron.build/docs/features/code-signing/))
- Signing secrets live in the same CI workflow: `CSC_LINK`, `WIN_CSC_LINK`, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`.

### Windows code signing — verified 2026 reality (primary sources)

The two refuted claims, corrected:
- **No certificate buys instant SmartScreen trust** — not even Microsoft's own service. Reputation accrues per publisher + file hash ("can take several weeks and hundreds of clean installs"). Only Microsoft Store distribution bypasses SmartScreen entirely. And **EV's old SmartScreen bypass is gone** — Microsoft docs: "Paying a premium for EV solely to avoid SmartScreen warnings is no longer justified." ([SmartScreen for app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation))
- The June 2023 hardware rule is a **CA/Browser Forum** requirement (not Microsoft), applies to **all** code-signing certs (OV/IV/EV): private keys must live in FIPS 140-2 Level 2+ hardware — USB token, own HSM, **or cloud signing service**. EV in CI is routine via cloud HSMs (DigiCert KeyLocker, SSL.com eSigner). ([CSBR §6.2.7.4](https://github.com/cabforum/code-signing))

Unsigned .exe behavior: Windows still runs it — gate is reputational. Blue "Windows protected your PC" → "More info → Run anyway". Unsigned apps restart from zero reputation **every release** (new hash, no publisher identity); signed apps accumulate certificate reputation across releases. Hard blocks: Smart App Control (Win11) and enterprise policy can remove "Run anyway" entirely.

**Azure Artifact Signing** (renamed from Trusted Signing; GA Jan 2026):
- ~$9.99/month Basic (5,000 signatures). OV-equivalent cert in your own name, keys in Microsoft FIPS L3 HSMs, short-lived certs renewed daily, no hardware.
- Eligibility: **individual developers US/Canada only**; organizations US/CA/EU/UK. Requires paid Azure subscription. (Kenya-based solo dev likely NOT eligible — check current region list; otherwise rung 3 below.)
- Native electron-builder support: `win.azureSignOptions` + `AZURE_TENANT_ID`/`CLIENT_ID`/`CLIENT_SECRET` env in CI. GitHub Action: `Azure/artifact-signing-action`.

**Recommendation ladder (solo OSS dev):**
1. **Unsigned** — fine for v0.x technical audience. Document click-through, publish SHA-256 checksums, list on **winget early** (Store/winget installs skip SmartScreen).
2. **SignPath Foundation** — free signing for qualifying OSS (OSI license, reproducible CI builds, MFA, per-release manual approval, public signing-policy page). Catch: publisher shows as "SignPath Foundation", not you.
3. **Azure Artifact Signing** ~$120/yr — best paid value if region-eligible.
4. **IV/OV cert + cloud signing** ~$300–800/yr (SSL.com eSigner has IV for individuals — works from any country).
5. **EV** — only for kernel drivers/enterprise checklists. Not for SmartScreen.

Always: consistent signing identity across releases, timestamp every signature — reputation is per-certificate; switching identities restarts the clock.

## Strategy for forinda-db-client

Phase 1 (v0.x, developer audience):
- GitHub Actions matrix → deb + AppImage (`toolsets.appimage: "1.0.3"`) on ubuntu runner, unsigned NSIS installer on windows runner. Tag-driven releases via `GITHUB_TOKEN`.
- AUR: `-bin` PKGBUILD over the released .deb, auto-pushed by `github-actions-deploy-aur` job (workflow above).
- Unsigned Windows OK for early adopters: document SmartScreen click-through, publish SHA-256 checksums, submit to winget early.
- In-app auto-update via electron-updater for AppImage + deb + NSIS; AUR updates via package manager.

Phase 2 (public 1.0):
- Windows signing: apply to SignPath Foundation (free, OSS) → fall back to IV cert + SSL.com eSigner (region-independent) or Azure Artifact Signing if region-eligible.
- macOS target only with Apple Developer account ($99/yr) + Developer ID + notarization step in the macos matrix leg.
- Flathub as secondary Linux channel (Electron BaseApp manifest).
