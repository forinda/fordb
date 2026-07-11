# Engines

Every engine implements the shared `DbAdapter` contract, and a contract-test suite keeps them consistent. Optional capabilities are **engine-gated** — the UI only offers what an engine actually supports, so you never see an action that can't work.

| Engine   | Status  | Notes                                                   |
| -------- | ------- | ------------------------------------------------------- |
| Postgres | Shipped | Browse, edit, full DDL, and a live server dashboard     |
| SQLite   | Shipped | Local file, remote (libsql / Turso), embedded replica   |
| MongoDB  | v0.3    | Document browse + query (document mode, not relational) |

## Capabilities

| Capability            | Postgres | SQLite | MongoDB |
| --------------------- | :------: | :----: | :-----: |
| Browse & edit rows    |    ✓     |   ✓    |    ✓    |
| Create / alter tables |    ✓     |   ✓    |    —    |
| Create database       |    ✓     |   —    |    —    |
| Foreign-key follow    |    ✓     |   ✓    |    —    |
| Server dashboard      |    ✓     |   —    |    —    |
| Document query        |    —     |   —    |    ✓    |

New engines add support by implementing `DbAdapter`, passing the contract suite, and registering in the connection registry — the UI and the rest of the app need no changes.
