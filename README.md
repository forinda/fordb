# fordb

**A lean, keyboard-first, open-source desktop database client.** Postgres and SQLite today, MongoDB planned — every engine free in core. Electron + TypeScript.

Lighter than DataGrip/DBeaver, but multi-engine unlike the single-database clients. Fast to open, driven from the keyboard, and honest about your data — every destructive change is previewed as SQL and confirmed before it runs.

> **Status:** active development. Grab a packaged installer from [Releases](https://github.com/forinda/fordb/releases), install via apt/dnf (below), or run from source.

## Install

**Linux (apt / dnf)** — new versions arrive with a normal system update:

```bash
# Debian / Ubuntu
curl -1sLf 'https://dl.cloudsmith.io/public/forinda/fordb/setup.deb.sh' | sudo -E bash
sudo apt update && sudo apt install fordb

# Fedora / RHEL
curl -1sLf 'https://dl.cloudsmith.io/public/forinda/fordb/setup.rpm.sh' | sudo -E bash
sudo dnf install fordb
```

Or download a standalone `.AppImage` / `.deb` / `.rpm` / Windows `.exe` from [Releases](https://github.com/forinda/fordb/releases).

**macOS** — download `fordb-<version>-universal.dmg` (runs on both Apple Silicon and Intel) from [Releases](https://github.com/forinda/fordb/releases), open it, and drag **fordb** to Applications.

The build is **unsigned** (code signing is on the roadmap), so on first launch macOS Gatekeeper says it "can't be opened because it is from an unidentified developer." Right-click the app → **Open** and confirm once, or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/fordb.app
```

## Run from source

**Prerequisites:** [Node.js](https://nodejs.org) ≥ 22 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev                 # launch in dev mode
pnpm dev:sandboxless     # Linux, if you hit a chrome-sandbox error
```

Common tasks: `pnpm build` · `pnpm test` · `pnpm lint` · `pnpm typecheck`. Contract tests need Docker (`pnpm db:up` then `pnpm test:contract`).

## Architecture

Three Electron processes so a compromised renderer can never touch a driver or a secret directly: **renderer** (React, no Node) → **main** (windows, OS keychain, stores) → **db-host** (utilityProcess, all DB drivers). Secrets never reach the renderer — connections are addressed by an opaque `connectionId`. The `DbAdapter` interface is the core contract, enforced by a shared contract-test suite.

Contributors: see [AGENTS.md](AGENTS.md) for conventions and [CONTRIBUTING.md](CONTRIBUTING.md) for setup. Cutting a release: [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE) © fordb contributors.
