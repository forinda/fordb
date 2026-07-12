# MongoDB

MongoDB is a first-class engine in fordb — a full document surface, not a read-only preview. Connect with discrete fields or a connection URI (the two stay in sync, like the Postgres form), and the schema tree lists databases → collections.

## Query documents

A collection opens a **document tab** with three modes:

- **find** — a relaxed-JSON filter (`{ status: "open" }`); results page as you scroll.
- **aggregate** — a JSON pipeline array (`[{ "$match": … }, { "$group": … }]`).
- **bulk** — see below.

**Explain** any find or aggregate to see the query plan (`executionStats`), and **Export** the full result to **JSON** or **NDJSON** (mongoexport's line-per-document format).

## Edit documents

Insert, edit, and delete documents by `_id` directly from the result cards — each change is a single-document write. Extended-JSON types (`ObjectId`, dates) round-trip losslessly.

## Bulk writes

Bulk mode takes a **filter** plus an operation:

- **updateMany** — apply an update document (e.g. `{ "$set": { "archived": true } }`) to every match.
- **deleteMany** — delete every match.

**Preview count** shows how many documents match before you commit, and Apply confirms with that count — with a loud warning if a `deleteMany` filter is empty (a whole-collection wipe).

## Collection & index admin

Right-click a collection or its database:

- **Indexes…** — list a collection's indexes and create (compound + unique) or drop them.
- **Validation…** — view, set, or clear the collection's schema-validation rule (`$jsonSchema`).
- **Rename / Drop collection**, and **New collection…** on the database node.

## User administration

**Users…** on a database node lists its users and their roles, creates a user (username, password, built-in role checkboxes such as `readWrite` / `dbAdmin`), and drops one. The password is used once at creation time — it never persists and never reaches the renderer.

Next: [Keyboard & Palette](/guide/keyboard) · [Engines](/reference/engines).
