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

// CHECK constraints. pg_get_constraintdef yields e.g. "CHECK ((age >= 0))" —
// the adapter strips the leading "CHECK " to store just the predicate.
export const GET_CHECKS = `
  SELECT con.conname AS name,
         pg_get_constraintdef(con.oid, true) AS def
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = $1 AND rel.relname = $2 AND con.contype = 'c'
  ORDER BY con.conname`

// Object browser (views/functions/triggers). Schema/name are bound params.
export const LIST_VIEWS = `SELECT viewname AS name FROM pg_views WHERE schemaname = $1 ORDER BY name`
// Collapse overloads to one node per name (avoids duplicate tree ids); functions
// + procedures only (exclude aggregate/window).
export const LIST_FUNCTIONS = `
  SELECT DISTINCT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = $1 AND p.prokind IN ('f', 'p') ORDER BY name`
export const LIST_TRIGGERS = `
  SELECT DISTINCT t.tgname AS name FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY name`
export const DEF_VIEW = `SELECT pg_get_viewdef((quote_ident($1) || '.' || quote_ident($2))::regclass, true) AS def`
// All overloads' definitions, joined — so clicking a name shows every overload
// (deterministic, not an arbitrary LIMIT 1 pick).
export const DEF_FUNCTION = `
  SELECT string_agg(pg_get_functiondef(p.oid), E'\n\n' ORDER BY p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind IN ('f', 'p')`
export const DEF_TRIGGER = `
  SELECT pg_get_triggerdef(t.oid, true) AS def FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND t.tgname = $2 LIMIT 1`

export const LIST_SEQUENCES = `
  SELECT sequencename AS name FROM pg_sequences WHERE schemaname = $1 ORDER BY name`
export const LIST_MATVIEWS = `
  SELECT matviewname AS name FROM pg_matviews WHERE schemaname = $1 ORDER BY name`
// Sequences have no pg_get_*def; reconstruct a CREATE SEQUENCE from pg_sequences.
export const DEF_SEQUENCE = `
  SELECT format(
    'CREATE SEQUENCE %I.%I%s INCREMENT BY %s MINVALUE %s MAXVALUE %s START %s%s',
    schemaname, sequencename,
    CASE WHEN data_type::text <> 'bigint' THEN ' AS ' || data_type::text ELSE '' END,
    increment_by, min_value, max_value, start_value,
    CASE WHEN cycle THEN ' CYCLE' ELSE '' END
  ) AS def
  FROM pg_sequences WHERE schemaname = $1 AND sequencename = $2`
// pg_get_viewdef works on materialized views too; wrap it in a CREATE.
export const DEF_MATVIEW = `
  SELECT 'CREATE MATERIALIZED VIEW ' || quote_ident($1) || '.' || quote_ident($2) ||
         ' AS ' || pg_get_viewdef((quote_ident($1) || '.' || quote_ident($2))::regclass, true) AS def`
