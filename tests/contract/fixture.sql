DROP SCHEMA IF EXISTS app CASCADE;
CREATE SCHEMA app;

CREATE TABLE app.users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.orders (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES app.users (id),
  amount numeric(10, 2) NOT NULL
);

CREATE INDEX orders_user_id_idx ON app.orders (user_id);

CREATE VIEW app.user_emails AS
SELECT id, email FROM app.users;

INSERT INTO app.users (email, name)
SELECT 'user' || i || '@example.com', 'User ' || i
FROM generate_series(1, 1000) AS i;

INSERT INTO app.orders (user_id, amount)
SELECT ((i - 1) % 1000) + 1, (i % 500)::numeric / 10
FROM generate_series(1, 5000) AS i;
