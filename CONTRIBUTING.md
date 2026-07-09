# Contributing to fordb

Thanks for helping build fordb — a lean, keyboard-first, multi-engine database client. For architecture and coding conventions, read [AGENTS.md](AGENTS.md) first; this file covers setup and workflow.

## Prerequisites

- **Node ≥ 22**, **pnpm** (`corepack enable` gives you pnpm), **Docker** (for contract tests), **git**.

## Setup

```bash
pnpm install
pnpm dev        # launches the Electron app
```

### Linux: chrome-sandbox error on `pnpm dev`

Electron's SUID sandbox needs its helper binary root-owned and setuid. If you see:

```
FATAL:... The SUID sandbox helper binary was found, but is not configured correctly.
... chrome-sandbox is owned by root and has mode 4755.
```

pick one:

1. **Quickest — skip the sandbox in dev only:**

   ```bash
   pnpm dev:sandboxless    # = ELECTRON_DISABLE_SANDBOX=1 electron-vite dev
   ```

   Dev convenience only. Never disable the sandbox in shipped builds.

2. **Make plain `pnpm dev` work (one-time, sudo):**

   ```bash
   sudo chown root:root node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
   sudo chmod 4755 node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
   ```

   Redo after any `pnpm install` (it regenerates `node_modules`) or Electron version bump.

3. **Enable unprivileged user namespaces (survives reinstalls):**
   ```bash
   sudo sysctl -w kernel.unprivileged_userns_clone=1
   ```
   Persist via `/etc/sysctl.d/`. On Ubuntu 24.04+ an AppArmor profile may still block it — fall back to option 1 or 2.

## Commands

| Command                       | What                                                           |
| ----------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                    | Run the app (see sandbox note above)                           |
| `pnpm dev:sandboxless`        | Run without the SUID sandbox (Linux dev)                       |
| `pnpm build`                  | Typecheck + bundle all three processes                         |
| `pnpm typecheck`              | `tsc --noEmit` for node + web configs                          |
| `pnpm lint`                   | eslint + prettier check                                        |
| `pnpm format`                 | prettier write                                                 |
| `pnpm test`                   | Unit tests (fast, no Docker)                                   |
| `pnpm db:up` / `pnpm db:down` | Start/stop the Postgres test container                         |
| `pnpm test:contract`          | Contract tests against Dockerized Postgres (run `db:up` first) |

Before pushing, run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, and `pnpm db:up && pnpm test:contract` if you touched db-host/adapters.

## Native modules

The SQLite engine uses [`@libsql/client`](https://github.com/tursodatabase/libsql-client-ts), which ships **N-API prebuilt binaries** — ABI-stable across Node and Electron, so the same install runs under both `pnpm test` (Node) and the Electron db-host with **no rebuild step**. (better-sqlite3 was evaluated but rejected: its Node/Electron ABI split would force a test↔app rebuild toggle.) The Postgres driver `pg` is pure JS; `ssh2`'s optional native bindings are marked external and degrade gracefully.

## Testing philosophy

- **Unit** (`tests/unit`): pure logic, keychain mocked, no Docker.
- **Contract** (`tests/contract`): real Postgres. Every engine adapter must pass the shared `runAdapterContractTests` suite — that's how a new engine proves itself.
- TDD: write the failing test first.

## Branch & PR workflow

- Branch off `main` per unit of work (`feat-…`, `fix-…`, `chore-…`).
- Keep the diff focused; conventional commit subjects (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Open a PR against `main`; CI runs lint + typecheck + unit + contract tests.
- Squash-merge.

## Security rules (non-negotiable)

- Connection secrets (password, SSH password/passphrase) live only in the OS keychain (`safeStorage`), never in `profiles.json`, never sent to the renderer.
- No plaintext fallback: if the keychain is unavailable, storing a secret must fail, not degrade.
- Keep the Electron sandbox enabled in anything you ship.
