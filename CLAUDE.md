# CLAUDE.md

This file orients Claude Code (and other AI agents) in the fordb repo. It is a pointer — the real content lives in the linked docs so context stays in one place.

## Read this first

**[AGENTS.md](AGENTS.md)** is the single source of truth for architecture and coding conventions. Read it before editing anything. Do not duplicate its content here.

## Quick facts

- fordb: lean, keyboard-first, MIT desktop DB client. Electron + TypeScript. Postgres now; SQLite + MongoDB planned. All engines free.
- Three processes: renderer (React 19 + Tailwind + Zustand), main (windows, keychain, stores, supervision), db-host (utilityProcess, all DB drivers).
- **Secrets never reach the renderer.** Connections are addressed by opaque `connectionId`. The `DbAdapter` interface is the core contract; a shared contract suite enforces it.

## Commands

`pnpm dev` (or `pnpm dev:sandboxless` on Linux without chrome-sandbox setup) · `pnpm build` · `pnpm test` (unit) · `pnpm db:up && pnpm test:contract` (contract, needs Docker) · `pnpm lint` · `pnpm typecheck`. Full table + setup in [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation map (context in one place)

| Doc                                          | What                                                            |
| -------------------------------------------- | --------------------------------------------------------------- |
| [AGENTS.md](AGENTS.md)                       | Architecture + coding conventions (**start here**)              |
| [CONTRIBUTING.md](CONTRIBUTING.md)           | Dev setup, commands, sandbox fix, workflow                      |
| [docs/06-prd.md](docs/06-prd.md)             | Product requirements                                            |
| [docs/07-work-plan.md](docs/07-work-plan.md) | Milestones M0–M8                                                |
| [docs/README.md](docs/README.md)             | Research index (framework, packaging, drivers, UI, competitors) |
| [docs/specs/](docs/specs/)                   | Design specs (per milestone)                                    |
| [docs/plans/](docs/plans/)                   | Implementation plans (per milestone)                            |

## Working conventions

- Follow AGENTS.md. TypeScript strict, no `any` outside the RPC boundary. TDD. Focused commits with conventional subjects.
- New secret field on a profile → strip it in `ProfileStore.save()` and route through the keychain.
- New engine → implement `DbAdapter`, pass `runAdapterContractTests`, register in the `ConnectionRegistry`.
- Development follows brainstorm → spec (`docs/specs/`) → plan (`docs/plans/`) → task-by-task execution with per-task review, then a PR per task against `main`.
