# APT + RPM Repository (Cloudsmith) — Design

**Status:** approved (Cloudsmith host; release-please path only; deb + rpm), ready for plan
**Date:** 2026-07-11
**Follows:** M5 release pipeline (v0.1.0 shipped)

## Goal

Let users install and **upgrade** fordb through their system package manager:
`apt update && apt upgrade fordb` on Debian/Ubuntu, `dnf upgrade fordb` on
Fedora/RHEL. Today the `.deb` is only attached to the GitHub Release (manual
`dpkg -i`, no upgrade path). This adds a hosted, signed package repository fed
automatically on each release.

Exit: with `CLOUDSMITH_API_KEY` configured, a release pushes the `.deb` + `.rpm`
to Cloudsmith; the documented `apt install fordb` / `dnf install fordb` lines
work and later releases upgrade in place.

## Scope

### In

- **Cloudsmith** as the repo host (free public-OSS tier, server-side GPG
  signing — no signing key owned by this project).
- **rpm** added to the electron-builder Linux targets (deb already built).
- A **secret-gated push step** in `release-please.yml` (the automated release
  path) that uploads the `.deb` + `.rpm` to Cloudsmith. No-op without the
  secret — a release still succeeds on `GITHUB_TOKEN` alone.
- **Install docs** (README + `docs/RELEASING.md`): the apt + dnf setup
  snippets and the `CLOUDSMITH_API_KEY` secret setup.

### Out (deferred)

- Our own GPG signing key / self-hosted index (Cloudsmith owns signing).
- Wiring the push into the manual `release.yml` fallback (release-please is the
  real path; the fallback keeps attaching to the GitHub Release only).
- arm64 builds, Flathub, macOS. AppImage stays portable (no repo). Arch is
  already covered by the AUR add-on.

## Architecture

Cloudsmith is an **additional sink**, parallel to the existing GitHub-Release
upload and the secret-gated AUR/winget steps. The release-please run already:
build (matrix) → `gh release upload` → finalize (SHA256SUMS + AUR + winget).
This adds one push to the **Linux build leg** (the only leg that has a `.deb` +
`.rpm` in `dist/`).

```
release-please PR merged
  └─ build (ubuntu)   → dist/*.deb, *.rpm, *.AppImage
        ├─ gh release upload  (unchanged)
        └─ cloudsmith push    (NEW, gated on CLOUDSMITH_API_KEY)   ← deb + rpm
  └─ build (windows)  → gh release upload  (unchanged)
  └─ finalize         → SHA256SUMS + AUR + winget  (unchanged)
```

One Cloudsmith repository (`forinda/fordb`, public) holds both formats. Uploads
target the wildcard distro `any-distro/any-version` so a single push serves all
Debian/Ubuntu releases (deb) and all Fedora/RHEL releases (rpm) rather than
maintaining a matrix of per-distro uploads.

## Components

### 1. electron-builder — rpm target

`electron-builder.yml`:

```yaml
linux:
  category: Development
  target: [AppImage, deb, rpm]
  artifactName: fordb-${version}-${arch}.${ext}
```

- rpm artifact: `fordb-<version>-x86_64.rpm` (electron-builder default naming;
  keep the existing `artifactName` unless it collides — verify in the plan).
- The rpm build needs `rpm`/`rpmbuild` on the runner. On `ubuntu-latest`:
  `sudo apt-get update && sudo apt-get install -y rpm`. No cross-distro Docker
  needed — electron-builder + fpm build the rpm on Ubuntu.

### 2. release-please.yml — Cloudsmith push step

In the `build` job, Linux leg only, after "Build + upload installers":

```yaml
- name: Push to Cloudsmith
  if: ${{ runner.os == 'Linux' && env.CLOUDSMITH_API_KEY != '' }}
  env:
    CLOUDSMITH_API_KEY: ${{ secrets.CLOUDSMITH_API_KEY }}
  run: |
    pipx install --python python3 cloudsmith-cli
    cloudsmith push deb forinda/fordb/any-distro/any-version dist/*.deb
    cloudsmith push rpm forinda/fordb/any-distro/any-version dist/*.rpm
```

- `CLOUDSMITH_API_KEY` surfaced as job-level `env` (secrets are invalid in
  step-level `if:` — same pattern as AUR/winget in `finalize`). The `build` job
  gains the `env:` block.
- `cloudsmith-cli` reads the key from `CLOUDSMITH_API_KEY` automatically.
- Absent secret → step skipped, release unaffected.

### 3. Install docs

README "Install" + `docs/RELEASING.md` gain:

```bash
# Debian / Ubuntu — add repo once, then apt tracks releases
curl -1sLf 'https://dl.cloudsmith.io/public/forinda/fordb/setup.deb.sh' | sudo -E bash
sudo apt update && sudo apt install fordb
# later: sudo apt update && sudo apt upgrade

# Fedora / RHEL
curl -1sLf 'https://dl.cloudsmith.io/public/forinda/fordb/setup.rpm.sh' | sudo -E bash
sudo dnf install fordb
```

`docs/RELEASING.md` also documents the `CLOUDSMITH_API_KEY` secret alongside
`AUR_SSH_KEY` / `WINGET_TOKEN`, and the one-time Cloudsmith account + repo
creation.

## Error handling / gating

- No secret → the push step is skipped by its `if:` guard; the release is
  unaffected (same contract as AUR/winget). A release NEVER depends on
  Cloudsmith.
- Push failure (network, quota) fails only the `build` Linux leg — the GitHub
  Release upload already ran before it, so the primary artifacts are safe. The
  step runs after `gh release upload` deliberately for this ordering.

## Testing

- **CI dry-run / PR CI:** the `rpm` target builds green (proves `rpm` tooling +
  electron-builder rpm packaging work). No new unit tests — packaging is config.
- **No-secret path:** verifiable immediately — with `CLOUDSMITH_API_KEY` unset,
  the push step skips and the release completes.
- **Full path (exit criterion, needs your action):** after creating the
  Cloudsmith repo + setting `CLOUDSMITH_API_KEY`, cut a release, then on a
  Debian box `apt install fordb` and on a Fedora box `dnf install fordb`;
  publish a later version and confirm `apt upgrade` moves to it.

## Risks

- **rpm build on Ubuntu** — electron-builder builds rpm via fpm; needs the
  `rpm` package. First rpm build may surface a missing-tool or naming issue —
  caught by PR CI (the build job runs on every PR).
- **`any-distro/any-version` compatibility** — a single deb/rpm served to all
  distro versions is standard for a self-contained Electron bundle (no distro
  library deps beyond the base). If a specific distro rejects it, fall back to
  naming concrete distros in the push targets. Low risk — the bundle ships its
  own Electron runtime.
- **Cloudsmith account/repo must exist before the secret does anything** —
  documented as a prerequisite; the pipeline stays dormant until then.

## Exit criteria

`rpm` builds in CI; the Cloudsmith push step is present and no-ops without the
secret; docs carry the apt/dnf install lines + secret setup. With
`CLOUDSMITH_API_KEY` set and a release cut, `apt install fordb` / `dnf install
fordb` work and a subsequent release upgrades in place.

## Task decomposition (for the plan)

1. **rpm target** — add `rpm` to `electron-builder.yml` Linux targets; install
   `rpm` on the runner in both build workflows; verify the rpm builds in CI.
2. **Cloudsmith push** — job-level `CLOUDSMITH_API_KEY` env + the gated push
   step in `release-please.yml`; verify it skips cleanly without the secret.
3. **Docs** — README install snippets (apt + dnf) + `docs/RELEASING.md`
   Cloudsmith secret/account setup.
