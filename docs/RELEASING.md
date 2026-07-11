# Releasing fordb

How to cut a public release. The pipeline is tag-driven: push a `vX.Y.Z` tag
and GitHub Actions builds, publishes, and checksums the installers.

## TL;DR

```bash
# 1. bump version in package.json (e.g. 0.1.0 -> 0.1.1), commit, merge to main
# 2. from an up-to-date main:
git tag -a v0.1.1 -m "fordb v0.1.1"
git push origin v0.1.1
# 3. watch it:  gh run watch --workflow release.yml
```

That's it. The `release.yml` workflow does the rest.

## What the tag triggers

`.github/workflows/release.yml` runs on any `v*` tag:

1. **build** (matrix: `ubuntu-latest` + `windows-latest`) — `pnpm build` then
   `electron-builder`, publishing artifacts to a **draft** GitHub Release for
   the tag:
   - `fordb-<version>-x86_64.AppImage` — Linux portable
   - `fordb_<version>_amd64.deb` — Debian/Ubuntu
   - `fordb-<version>-setup.exe` (+ `.blockmap`) — Windows NSIS installer
   - `latest.yml` / `latest-linux.yml` — updater metadata (published now,
     consumed once electron-updater is wired)
2. **finalize** (tag only) — downloads the assets, writes `SHA256SUMS`,
   uploads it, then flips the release from draft to public. Also runs the
   secret-gated AUR + winget steps (see below).

The release is a draft until `finalize` publishes it, so a half-built release
never goes public.

## Prerequisites

- Version in `package.json` matches the tag (`v0.1.1` → `"version": "0.1.1"`).
  The `deb` build needs the `author` email field — already set, don't remove.
- Tag from `main` after CI is green.
- Only `GITHUB_TOKEN` (auto-provided) is required. AUR/winget are optional
  add-ons and no-op without their secrets — a release succeeds on the default
  token alone.

## Dry run (optional, no tag)

Prove the matrix + native builds + NSIS work without cutting a release:

```bash
gh workflow run release.yml            # workflow_dispatch, --publish never
gh run watch --workflow release.yml
```

Builds all three installers on both runners and uploads them as run
artifacts (no Release created, no publish).

## Optional distribution channels

Both live in the `finalize` job and skip cleanly when their secret is unset.

### AUR (`fordb-bin`)

Set repo secret **`AUR_SSH_KEY`** (an AUR account's SSH private key, maintainer
of `fordb-bin`). On the next tagged release the PKGBUILD in
`packaging/aur/PKGBUILD` is pushed to the AUR automatically.

### winget

Set repo secret **`WINGET_TOKEN`** (a GitHub PAT with a `winget-pkgs` fork).
The step currently logs the intended submission; uncomment the `komac` line in
`release.yml` to submit `packaging/winget/*.yaml` live. Needs a maintainer PAT
+ fork — see the commented block in the workflow.

## Verifying a release

```bash
gh release view v0.1.1 --json isDraft,assets    # isDraft=false, 7 assets
# checksum a download:
gh release download v0.1.1 --pattern '*.AppImage' --pattern 'SHA256SUMS'
grep AppImage SHA256SUMS | sha256sum -c -
```

Smoke the packaged app (native drivers must load from `app.asar.unpacked`):

```bash
chmod +x fordb-*.AppImage
./fordb-*.AppImage --appimage-extract-and-run   # opens the window
```

## Troubleshooting

- **Native dep fails to load in the packaged app** — check the module is
  covered by `asarUnpack` in `electron-builder.yml` (currently `**/*.node`,
  `@libsql`, `ssh2`, `cpu-features`). Highest-risk area when adding a driver.
- **`electron-builder` prunes the wrong deps** — packaging relies on
  `.npmrc` `node-linker=hoisted`; keep it.
- **deb build: "Please specify author 'email'"** — restore the `author`
  object (name + email) in `package.json`.
- **Windows NSIS path/casing errors** — run the dry run before tagging.

## Deferred (not in this pipeline yet)

electron-updater in-app auto-update (metadata is already published),
macOS dmg + code signing / notarization (M8), Flathub.
