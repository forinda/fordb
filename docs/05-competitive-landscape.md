# 05 — Competitive Landscape

Question: what exists (DBeaver, TablePlus, Beekeeper Studio, DataGrip, Antares SQL, Sqlectron), what stack, what gaps can a lean client fill?

## Verified findings (2026-07)

### Beekeeper Studio — the closest reference

- Stack: TypeScript (~59%) + Vue (~24%) + Electron; electron 39.x, electron-builder 26.x. ([repo](https://github.com/beekeeper-studio/beekeeper-studio), verified via GitHub API 2026-07-08)
- Engines: 22 marked full-support in README (PostgreSQL, MySQL, SQLite, MongoDB, ClickHouse, DuckDB, Cassandra, Oracle, LibSQL…) via a multi-engine adapter architecture in a Node/Electron codebase. Their marketing says "20+"; "25+" figures are inflated.
- **Licensing catch: community edition covers 11 engines; MongoDB, ClickHouse, DuckDB, Cassandra, Oracle, LibSQL are paid-edition-only** — though adapter code is source-available in the same repo (GPL-licensed; useful as architecture reference, check license before borrowing code).
- Positioning: explicitly anti-"kitchen sink" — README: "If a new feature compromises this vision, we kill it." Same lean niche this project targets.

### Sqlectron — the lightweight incumbent

- Self-positions as "a simple and lightweight SQL client with cross database and platform support". Electron + React, ~94% TypeScript. Actively maintained (v1.39.0 Dec 2025, push June 2026, ~4.8k stars). ([repo](https://github.com/sqlectron/sqlectron), verified via GitHub API 2026-07-08)
- Historically slow release cadence and limited feature depth — that gap (depth + polish at the same weight class) is the opening.

### Others (from search phase; not adversarially verified)

- DBeaver: Java/Eclipse RCP — powerful, heavy, dated UX. The "bulky" complaint personified.
- DataGrip: JetBrains IDE platform — deep but paid + heavyweight (user's stated pain).
- TablePlus: native (Swift/C++), lean and fast — but proprietary, paid, and macOS-first heritage.
- Antares SQL: Electron + Vue, open source, active.
- dbx: Tauri-based, ~15MB, 17 databases — proof people want lean multi-DB; also proof the niche is being attacked from the Tauri side. ([dev.to writeup](https://dev.to/t8y2/dbx-an-open-source-15-mb-database-client-for-17-databases-built-with-tauri-45oe))
- HN thread on yet-another-DB-client ([discussion](https://news.ycombinator.com/item?id=46268339)): recurring practitioner complaints about incumbents — bloat, slow startup, paywalled basics, poor keyboard UX.

## What this means for forinda-db-client

The stack is validated twice over (Beekeeper, Sqlectron): TS + Electron + multi-engine adapter works. But "lean multi-DB Electron app" alone is an occupied niche. Differentiators to weigh in the PRD:

1. **Free where Beekeeper charges** — MongoDB support in the free core is a concrete wedge (Compass is Mongo-only; Beekeeper paywalls Mongo).
2. **Keyboard-first, command-palette UX** — recurring HN complaint; nobody in the open-source set nails it.
3. **Fast cold start + low memory ceiling** as a measured, published benchmark (make leanness a feature with numbers, not an adjective).
4. **Clean SQL + document (Mongo) dual experience** in one tool — the pgAdmin/Compass split is the user's original pain.
5. Narrow scope discipline: connections, browse, query, edit rows, export. No ERD designers, no report builders (DBeaver kitchen-sink territory).

## Risks

- Beekeeper could move paid engines to community edition at any time.
- Tauri-side competitors (dbx) own the "tiny binary" story; our leanness must be runtime UX, not download size.
