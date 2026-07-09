export const LIST_DATABASES = `
  SELECT datname FROM pg_database
  WHERE datallowconn AND NOT datistemplate
  ORDER BY datname`

export const LIST_SCHEMAS = `
  SELECT nspname FROM pg_namespace
  WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
  ORDER BY nspname`

export const LIST_TABLES = `
  SELECT table_name AS name,
         CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS type
  FROM information_schema.tables
  WHERE table_schema = $1
  ORDER BY table_name`

export const GET_COLUMNS = `
  SELECT column_name AS name,
         data_type AS "dataType",
         is_nullable = 'YES' AS nullable,
         column_default AS "defaultValue",
         ordinal_position AS ordinal
  FROM information_schema.columns
  WHERE table_schema = $1 AND table_name = $2
  ORDER BY ordinal_position`

export const GET_KEYS = `
  SELECT con.conname AS name,
         CASE con.contype WHEN 'p' THEN 'primary' WHEN 'f' THEN 'foreign' ELSE 'unique' END AS kind,
         ARRAY(
           SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         ) AS columns,
         confrel.relname AS "referencedTable",
         ARRAY(
           SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         ) AS "referencedColumns"
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  LEFT JOIN pg_class confrel ON confrel.oid = con.confrelid
  WHERE nsp.nspname = $1 AND rel.relname = $2 AND con.contype IN ('p', 'f', 'u')
  ORDER BY con.conname`

export const GET_INDEXES = `
  SELECT ic.relname AS name,
         ARRAY(
           SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         ) AS columns,
         ix.indisunique AS unique
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace nsp ON nsp.oid = tc.relnamespace
  WHERE nsp.nspname = $1 AND tc.relname = $2 AND NOT ix.indisprimary
  ORDER BY ic.relname`
