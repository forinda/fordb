# Engines

| Engine   | Status  | Notes                                               |
| -------- | ------- | --------------------------------------------------- |
| Postgres | Shipped | Full: browse, edit, DDL, server dashboard           |
| SQLite   | Shipped | Local file, remote (libsql/Turso), embedded replica |
| MongoDB  | v0.3    | Document browse + query                             |

Every engine implements the shared `DbAdapter` contract; optional capabilities are engine-gated, so the UI only offers what an engine supports.
