import { createClient } from '@libsql/client'

const SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), amount REAL NOT NULL);
  CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders(user_id);
  CREATE VIEW IF NOT EXISTS user_emails AS SELECT id, email FROM users;
  CREATE TRIGGER IF NOT EXISTS users_touch AFTER UPDATE ON users BEGIN SELECT 1; END;
  INSERT INTO users (email, name)
  WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 1000)
  SELECT 'user' || i || '@example.com', 'User ' || i FROM seq;
  INSERT INTO orders (user_id, amount)
  WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 5000)
  SELECT ((i - 1) % 1000) + 1, (i % 500) / 10.0 FROM seq;`

/** Seeds the shared fixture into the sqld at `url`. Drops first so re-runs
 *  don't accumulate rows. */
export async function seedSqld(url: string): Promise<void> {
  const c = createClient({ url })
  await c.executeMultiple(
    `DROP TRIGGER IF EXISTS users_touch; DROP VIEW IF EXISTS user_emails; DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS users;`
  )
  await c.executeMultiple(SQL)
  c.close()
}
