# APT + RPM Repository (Cloudsmith) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish fordb's `.deb` + `.rpm` to a Cloudsmith repository on every automated release so users can `apt install fordb` / `dnf install fordb` and upgrade in place.

**Architecture:** Add `rpm` to the electron-builder Linux targets, install `rpm` tooling on the Ubuntu runner, and add one secret-gated `cloudsmith push` step to the Linux build leg of `release-please.yml`. Cloudsmith hosts + signs the repo (no signing key owned here). The push is an additional sink parallel to the existing GitHub-Release upload and no-ops without `CLOUDSMITH_API_KEY`.

**Tech Stack:** electron-builder (deb/rpm via fpm), GitHub Actions, cloudsmith-cli (Python, via pipx), release-please.

## Global Constraints

- Push step MUST no-op when `CLOUDSMITH_API_KEY` is unset; a release MUST succeed on `GITHUB_TOKEN` alone (same contract as AUR/winget).
- Secrets are invalid in step-level `if:` — surface as job-level `env:`, gate on `env.NAME != ''`.
- Cloudsmith target repo + push coordinates: `forinda/fordb/any-distro/any-version` (one upload serves all distro versions).
- No new unit tests — packaging is config. Verification is CI dry-run + no-secret skip.
- release-please is the automated release path; the push wires there only, not into the `release.yml` manual fallback.
- Conventional-commit subjects on every commit (`feat:`/`fix:`/`ci:`/`docs:`). Commit trailers: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_018AGzg9pdVag7LZ83ktnnnX`.

## File Structure

- `electron-builder.yml` — add `rpm` to `linux.target`; add an `rpm:` artifactName block.
- `.github/workflows/release-please.yml` — install `rpm` in the build job; add job-level `CLOUDSMITH_API_KEY` env + the gated push step.
- `.github/workflows/release.yml` — install `rpm` in the build job (so the manual fallback + dry-run also build the rpm); add `dist/*.rpm` to the dry-run artifact upload.
- `README.md` — apt + dnf install snippets.
- `docs/RELEASING.md` — Cloudsmith account + `CLOUDSMITH_API_KEY` secret setup.

---

### Task 1: rpm build target

**Files:**

- Modify: `electron-builder.yml:21-30`
- Modify: `.github/workflows/release-please.yml` (build job, after `pnpm install`)
- Modify: `.github/workflows/release.yml` (build job, after `pnpm install`; dry-run upload paths)

**Interfaces:**

- Produces: `dist/fordb-<version>-x86_64.rpm` in the Linux build leg of both release workflows, alongside the existing `dist/*.deb` and `dist/*.AppImage`.

- [ ] **Step 1: Add rpm to the Linux targets**

In `electron-builder.yml`, change the `linux` block and add an `rpm` artifactName block (mirrors the existing `deb`/`appImage` blocks):

```yaml
linux:
  category: Development
  icon: build/icon.png
  target:
    - AppImage
    - deb
    - rpm
appImage:
  artifactName: fordb-${version}-${arch}.AppImage
deb:
  artifactName: fordb_${version}_${arch}.deb
rpm:
  artifactName: fordb-${version}-${arch}.rpm
```

- [ ] **Step 2: Install rpm tooling on the runner — release-please.yml**

In `.github/workflows/release-please.yml`, in the `build` job, add a step immediately after `- run: pnpm install --frozen-lockfile` and before "Build + upload installers". Guard it to Linux so the Windows leg skips it:

```yaml
- name: Install rpm tooling (Linux)
  if: runner.os == 'Linux'
  run: sudo apt-get update && sudo apt-get install -y rpm
```

- [ ] **Step 3: Install rpm tooling on the runner — release.yml**

In `.github/workflows/release.yml`, in the `build` job, add the same step immediately after `- run: pnpm install --frozen-lockfile` and before "Build + package":

```yaml
- name: Install rpm tooling (Linux)
  if: runner.os == 'Linux'
  run: sudo apt-get update && sudo apt-get install -y rpm
```

- [ ] **Step 4: Add rpm to the release.yml dry-run artifact upload**

In `.github/workflows/release.yml`, in the "Upload artifacts (dry-run visibility)" step's `path:` list, add the rpm line so a dry-run surfaces it:

```yaml
path: |
  dist/*.AppImage
  dist/*.deb
  dist/*.rpm
  dist/*.exe
  dist/*.yml
```

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml .github/workflows/release-please.yml .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
ci: build an rpm alongside the deb

Adds rpm to the electron-builder Linux targets and installs rpm tooling on
the Ubuntu runner in both release workflows so dnf/yum users get a package.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018AGzg9pdVag7LZ83ktnnnX
EOF
)"
```

- [ ] **Step 6: Verify the rpm builds in CI (dry-run)**

The rpm is only built by electron-builder, which runs in the release workflows — not in `ci.yml`'s `build` job (that runs `pnpm build` only). Trigger the manual dry-run on the branch and confirm the rpm appears:

```bash
git push -u origin <branch>
gh workflow run release.yml --ref <branch>
gh run watch --workflow release.yml
# after it completes, the ubuntu leg's "installers-ubuntu-latest" artifact
# must contain fordb-<version>-x86_64.rpm
gh run download --name installers-ubuntu-latest --dir /tmp/fordb-dryrun
ls /tmp/fordb-dryrun/*.rpm    # expect: fordb-<version>-x86_64.rpm
```

Expected: the ubuntu build leg is green and `*.rpm` is present. If the rpm step fails with a missing `rpmbuild`, confirm Step 2/3 installed `rpm`; if fpm errors on naming, check the `rpm:` artifactName block from Step 1.

---

### Task 2: Cloudsmith push step

**Files:**

- Modify: `.github/workflows/release-please.yml` (build job: add job-level `env`, add push step)

**Interfaces:**

- Consumes: `dist/*.deb` + `dist/*.rpm` produced by Task 1 in the Linux build leg.
- Produces: on a real release with `CLOUDSMITH_API_KEY` set, the deb + rpm are pushed to `forinda/fordb`. With the secret unset, the step is skipped.

- [ ] **Step 1: Add the job-level secret env to the build job**

In `.github/workflows/release-please.yml`, the `build` job currently has no `env:` at job level. Add one directly under `runs-on: ${{ matrix.os }}` (a sibling of `strategy`/`steps`), so the secret can be referenced in a step-level `if:` via `env`:

```yaml
build:
  needs: release-please
  if: ${{ needs.release-please.outputs.release_created }}
  strategy:
    fail-fast: false
    matrix:
      os: [ubuntu-latest, windows-latest]
  runs-on: ${{ matrix.os }}
  # secrets are invalid in step-level `if:`; surface as env first.
  env:
    CLOUDSMITH_API_KEY: ${{ secrets.CLOUDSMITH_API_KEY }}
  steps:
```

- [ ] **Step 2: Add the gated push step**

In the same `build` job, add this step at the END of the `steps:` list, after the existing "Build + upload installers" step. It runs only on the Linux leg (the only one with a deb/rpm) and only when the secret is set:

```yaml
- name: Push to Cloudsmith
  if: ${{ runner.os == 'Linux' && env.CLOUDSMITH_API_KEY != '' }}
  run: |
    pipx install cloudsmith-cli
    cloudsmith push deb forinda/fordb/any-distro/any-version dist/*.deb
    cloudsmith push rpm forinda/fordb/any-distro/any-version dist/*.rpm
```

`cloudsmith-cli` reads the API key from the `CLOUDSMITH_API_KEY` env var (already exported job-level), so no extra `env:` on the step is needed.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-please.yml
git commit -m "$(cat <<'EOF'
ci: push deb + rpm to Cloudsmith on release

Secret-gated step in the release-please Linux build leg. No-ops without
CLOUDSMITH_API_KEY, so a release still succeeds on GITHUB_TOKEN alone.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018AGzg9pdVag7LZ83ktnnnX
EOF
)"
```

- [ ] **Step 4: Verify the step no-ops without the secret**

`CLOUDSMITH_API_KEY` is not set in the repo, so the step must be skipped on the next merge to `main`. Confirm the workflow is still syntactically valid and the guard is correct by asserting on the YAML directly (no push should ever run without the secret):

```bash
# guard present exactly as intended
grep -A1 "Push to Cloudsmith" .github/workflows/release-please.yml | grep "runner.os == 'Linux' && env.CLOUDSMITH_API_KEY != ''"
# workflow parses (actionlint if available, else yaml load)
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release-please.yml')); print('yaml ok')"
```

Expected: the grep matches the guard line and `yaml ok` prints. On the next real release without the secret, the "Push to Cloudsmith" step shows as skipped in the run — the release is unaffected. (Full push is exercised only once `CLOUDSMITH_API_KEY` is configured — that is the milestone exit criterion, gated on the maintainer creating the Cloudsmith repo.)

---

### Task 3: Install docs

**Files:**

- Modify: `README.md` (install section)
- Modify: `docs/RELEASING.md` (optional distribution channels / secrets)

**Interfaces:**

- Consumes: the Cloudsmith repo coordinates `forinda/fordb` and the `CLOUDSMITH_API_KEY` secret name from Tasks 1–2.

- [ ] **Step 1: Add apt + dnf install snippets to README**

In `README.md`, in the install/download area, add a section (place it near the existing Releases/installers mention):

````markdown
### Install via package manager (Linux)

Track releases through apt or dnf — new versions arrive with a normal system update.

```bash
# Debian / Ubuntu
curl -1sLf 'https://dl.cloudsmith.io/public/forinda/fordb/setup.deb.sh' | sudo -E bash
sudo apt update && sudo apt install fordb
# upgrade later: sudo apt update && sudo apt upgrade

# Fedora / RHEL
curl -1sLf 'https://dl.cloudsmith.io/public/forinda/fordb/setup.rpm.sh' | sudo -E bash
sudo dnf install fordb
```
````

Or grab a standalone `.AppImage` / `.deb` / `.rpm` / Windows `.exe` from the [Releases](https://github.com/forinda/fordb/releases) page.

````

- [ ] **Step 2: Document the Cloudsmith secret in RELEASING.md**

In `docs/RELEASING.md`, under the "Optional distribution channels" section (alongside AUR and winget), add:

```markdown
### apt / dnf (Cloudsmith)

Set repo secret **`CLOUDSMITH_API_KEY`** (from a free Cloudsmith OSS account,
API key with push rights on the `forinda/fordb` repository). Create the
repository once at cloudsmith.io as `forinda/fordb` (public, formats: deb +
rpm). With the secret set, each release pushes the `.deb` + `.rpm` to
Cloudsmith and `apt install fordb` / `dnf install fordb` (see README) track new
versions. Without the secret the push step is skipped — Cloudsmith is never on
the critical path of a release.
````

- [ ] **Step 3: Prettier-format the docs**

The repo's `pnpm lint` runs `prettier --check .` and will fail CI on unformatted markdown. Format the two files before committing:

```bash
pnpm exec prettier --write README.md docs/RELEASING.md
pnpm exec prettier --check README.md docs/RELEASING.md   # expect: "All matched files use Prettier code style!"
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/RELEASING.md
git commit -m "$(cat <<'EOF'
docs: apt/dnf install via Cloudsmith + CLOUDSMITH_API_KEY setup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018AGzg9pdVag7LZ83ktnnnX
EOF
)"
```

- [ ] **Step 5: Verify docs render + lint clean**

```bash
pnpm lint    # eslint . && prettier --check . — expect no failures on README.md / docs/RELEASING.md
```

Expected: lint passes. Eyeball the README section renders as two fenced install blocks.

---

## Self-Review

**1. Spec coverage:**

- rpm target (spec §Components/1) → Task 1 ✓
- runner rpm tooling → Task 1 Steps 2–3 ✓
- Cloudsmith push, gated, Linux leg (spec §Components/2) → Task 2 ✓
- job-level env / `env.*` gate (spec §Error handling) → Task 2 Step 1 ✓
- no-op-without-secret verification (spec §Testing) → Task 2 Step 4 ✓
- README apt+dnf snippets (spec §Components/3) → Task 3 Steps 1 ✓
- RELEASING.md secret+account setup → Task 3 Step 2 ✓
- rpm builds in CI (spec §Testing) → Task 1 Step 6 (release.yml dry-run) ✓
- `any-distro/any-version` coordinates → Task 2 Step 2 ✓
  No gaps.

**2. Placeholder scan:** No TBD/TODO; every code step shows the exact YAML/markdown/commands. `<branch>` in Task 1 Step 6 is a run-time value the executor fills, not a content placeholder.

**3. Consistency:** `CLOUDSMITH_API_KEY`, `forinda/fordb/any-distro/any-version`, `fordb-${version}-${arch}.rpm`, and the `runner.os == 'Linux' && env.CLOUDSMITH_API_KEY != ''` guard are identical across the tasks that reference them and match the spec.
