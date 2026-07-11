# Schema & Structure

The schema tree (schemas → tables/views → columns) is lazy-loaded and shared with the SQL autocomplete. Refresh it any time; right-click a node for actions.

## Inspect a table

Open a table's **Structure** view to see its columns, keys, and indexes, plus a reconstructed `CREATE TABLE`. For Postgres you also get a live **server dashboard** — sessions, locks, and connection load.

## Create and alter, safely

Everything that changes structure is generated as SQL, shown to you, and **confirmed before it runs** — in a transaction where the engine supports it.

- **Create tables** with a tabbed designer: columns (name, type from a dropdown, nullable, primary key, unique, default) and a **Foreign Keys** tab whose reference dropdowns are populated from your schema. A live `CREATE TABLE` preview updates as you go.
- **Create databases** (Postgres) with full metadata — owner, encoding, template, collation, tablespace, connection limit.
- **Alter** existing tables: add / rename / drop columns, change type/default/nullable, add or drop indexes and foreign keys, drop tables. Postgres alters in place; SQLite uses native `ALTER` or a safe table-rebuild that preserves data, indexes, and constraints.

![fordb create-table designer](/screenshots/designer.png)

Next: [Keyboard & Palette](/guide/keyboard) · [Engines](/reference/engines).
