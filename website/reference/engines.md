# Engines

Every engine implements the shared `DbAdapter` contract, and a contract-test suite keeps them consistent. Optional capabilities are **engine-gated** — the UI only offers what an engine actually supports, so you never see an action that can't work.

| Engine   | Status  | Notes                                                               |
| -------- | ------- | ------------------------------------------------------------------- |
| Postgres | Shipped | Browse, edit, deep DDL, roles & grants, and a live server dashboard |
| SQLite   | Shipped | Local file, remote (libsql / Turso), embedded replica               |
| MongoDB  | Shipped | Full document surface — query, edit, admin, and users               |

## Relational capabilities (Postgres / SQLite)

| Capability                                     | Postgres | SQLite |
| ---------------------------------------------- | :------: | :----: |
| Browse & edit rows, foreign-key follow         |    ✓     |   ✓    |
| Create / alter / drop tables                   |    ✓     |   ✓    |
| Generated columns                              |    ✓     |   ✓    |
| Check constraints (list / add / drop)          |    ✓     |   —    |
| Partial & expression indexes                   |    ✓     |   ✓    |
| Sequences & materialized views                 |    ✓     |   —    |
| Functions & triggers (author / drop)           |    ✓     |   —    |
| Create database                                |    ✓     |   —    |
| Roles / users, grant & revoke privileges       |    ✓     |   —    |
| Table maintenance (VACUUM / ANALYZE / REINDEX) |    ✓     |   —    |
| TLS client cert / key / CA, SSH tunnel         |    ✓     |   —    |
| Live server dashboard (sessions / locks)       |    ✓     |   —    |

## MongoDB capabilities

| Capability                                      | MongoDB |
| ----------------------------------------------- | :-----: |
| Browse collections, find & aggregate queries    |    ✓    |
| Edit / insert / delete documents                |    ✓    |
| Bulk `updateMany` / `deleteMany` (with preview) |    ✓    |
| Index management (list / create / drop)         |    ✓    |
| Collection admin (create / drop / rename)       |    ✓    |
| Explain plans (find & aggregate)                |    ✓    |
| Export query results (JSON / NDJSON)            |    ✓    |
| Schema validation rules (`$jsonSchema`)         |    ✓    |
| User administration (create / drop / roles)     |    ✓    |
| Server dashboard (Mongo metrics)                |    ✓    |

Every capability is **engine-gated** — the UI only offers what an engine actually supports, so you never see an action that can't work. New engines add support by implementing `DbAdapter`, passing the contract suite, and registering in the connection registry — the UI and the rest of the app need no changes.
