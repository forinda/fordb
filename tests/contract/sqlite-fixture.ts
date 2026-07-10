import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Builds a temp SQLite file whose `main` schema mirrors the shared Postgres
// contract fixture (tests/contract/fixture.sql): users(id pk, email unique
// not-null, name null, created_at default) with 1000 rows user1..user1000,
// orders(id pk, user_id fk→users, amount) with 5000 rows, view user_emails,
// index orders_user_id_idx. Returns the file path.
export async function buildSqliteFixture(): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-sqlite-')), 'app.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount REAL NOT NULL
    );
    CREATE INDEX orders_user_id_idx ON orders(user_id);
    CREATE VIEW user_emails AS SELECT id, email FROM users;
    CREATE TRIGGER users_touch AFTER UPDATE ON users BEGIN SELECT 1; END;
    INSERT INTO users (email, name)
    WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 1000)
    SELECT 'user' || i || '@example.com', 'User ' || i FROM seq;
    INSERT INTO orders (user_id, amount)
    WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 5000)
    SELECT ((i - 1) % 1000) + 1, (i % 500) / 10.0 FROM seq;
  `)
  db.close()
  return file
}
