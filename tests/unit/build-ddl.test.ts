import { describe, it, expect } from 'vitest'
import { buildDdl, reconstructDdl } from '../../src/shared/ddl/build-ddl'
import type { DdlChange } from '../../src/shared/adapter/schema-types'

describe('buildDdl', () => {
  it('createTable: columns, NOT NULL, DEFAULT, PK', () => {
    const change: DdlChange = {
      kind: 'createTable',
      spec: {
        schema: 'app',
        table: 't',
        columns: [
          { name: 'id', type: 'integer', notNull: true },
          { name: 'name', type: 'text', default: `'x'` }
        ],
        primaryKey: ['id']
      }
    }
    expect(buildDdl(change, 'pg')).toEqual([
      `CREATE TABLE "app"."t" (\n  "id" integer NOT NULL,\n  "name" text DEFAULT 'x',\n  PRIMARY KEY ("id")\n)`
    ])
  })
  it('addColumn', () => {
    const change: DdlChange = {
      kind: 'addColumn',
      schema: 'app',
      table: 't',
      column: { name: 'age', type: 'integer', notNull: true }
    }
    expect(buildDdl(change, 'pg')).toEqual([
      `ALTER TABLE "app"."t" ADD COLUMN "age" integer NOT NULL`
    ])
  })
  it('createIndex (unique) and dropIndex', () => {
    expect(
      buildDdl(
        {
          kind: 'createIndex',
          spec: { schema: 'app', table: 't', name: 'i', columns: ['a', 'b'], unique: true }
        },
        'pg'
      )
    ).toEqual([`CREATE UNIQUE INDEX "i" ON "app"."t" ("a", "b")`])
    expect(buildDdl({ kind: 'dropIndex', schema: 'app', name: 'i' }, 'pg')).toEqual([
      `DROP INDEX "app"."i"`
    ])
  })
  it('sqlite dropIndex qualifies the index name', () => {
    expect(buildDdl({ kind: 'dropIndex', schema: 'main', name: 'i' }, 'sqlite')).toEqual([
      `DROP INDEX "main"."i"`
    ])
  })
  it('addForeignKey / dropForeignKey (pg)', () => {
    expect(
      buildDdl(
        {
          kind: 'addForeignKey',
          spec: {
            schema: 'app',
            table: 'orders',
            name: 'orders_user_fk',
            columns: ['user_id'],
            refSchema: 'app',
            refTable: 'users',
            refColumns: ['id']
          }
        },
        'pg'
      )
    ).toEqual([
      `ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_user_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users" ("id")`
    ])
    expect(
      buildDdl(
        { kind: 'dropForeignKey', schema: 'app', table: 'orders', name: 'orders_user_fk' },
        'pg'
      )
    ).toEqual([`ALTER TABLE "app"."orders" DROP CONSTRAINT "orders_user_fk"`])
  })
  it('dropTable / createSchema / dropSchema / createDatabase / dropDatabase', () => {
    expect(buildDdl({ kind: 'dropTable', schema: 'app', table: 't' }, 'pg')).toEqual([
      `DROP TABLE "app"."t"`
    ])
    expect(buildDdl({ kind: 'createSchema', name: 's' }, 'pg')).toEqual([`CREATE SCHEMA "s"`])
    expect(buildDdl({ kind: 'dropSchema', name: 's' }, 'pg')).toEqual([`DROP SCHEMA "s"`])
    expect(buildDdl({ kind: 'createDatabase', name: 'd' }, 'pg')).toEqual([`CREATE DATABASE "d"`])
    expect(buildDdl({ kind: 'dropDatabase', name: 'd' }, 'pg')).toEqual([`DROP DATABASE "d"`])
  })
  it('sqlite: schema-qualified except CREATE INDEX (schema on the index name, bare ON-table)', () => {
    expect(
      buildDdl(
        {
          kind: 'createTable',
          spec: { schema: 'temp', table: 't', columns: [{ name: 'id', type: 'integer' }] }
        },
        'sqlite'
      )
    ).toEqual([`CREATE TABLE "temp"."t" (\n  "id" integer\n)`])
    expect(
      buildDdl(
        { kind: 'addColumn', schema: 'temp', table: 't', column: { name: 'a', type: 'text' } },
        'sqlite'
      )
    ).toEqual([`ALTER TABLE "temp"."t" ADD COLUMN "a" text`])
    // The index name carries the schema; the ON-table is bare (SQLite rejects a
    // qualified ON-table).
    expect(
      buildDdl(
        { kind: 'createIndex', spec: { schema: 'temp', table: 't', name: 'i', columns: ['a'] } },
        'sqlite'
      )
    ).toEqual([`CREATE INDEX "temp"."i" ON "t" ("a")`])
    expect(buildDdl({ kind: 'dropTable', schema: 'temp', table: 't' }, 'sqlite')).toEqual([
      `DROP TABLE "temp"."t"`
    ])
  })
  it('quotes identifiers with embedded quotes', () => {
    expect(buildDdl({ kind: 'dropTable', schema: 'a"b', table: 't"x' }, 'pg')).toEqual([
      `DROP TABLE "a""b"."t""x"`
    ])
  })

  it('pg renameColumn / dropColumn', () => {
    expect(
      buildDdl({ kind: 'renameColumn', schema: 'app', table: 't', from: 'a', to: 'b' }, 'pg')
    ).toEqual([`ALTER TABLE "app"."t" RENAME COLUMN "a" TO "b"`])
    expect(buildDdl({ kind: 'dropColumn', schema: 'app', table: 't', column: 'a' }, 'pg')).toEqual([
      `ALTER TABLE "app"."t" DROP COLUMN "a"`
    ])
  })
  it('pg alterColumn: one statement per changed field, stable order', () => {
    expect(
      buildDdl(
        {
          kind: 'alterColumn',
          schema: 'app',
          table: 't',
          column: 'a',
          type: 'text',
          default: `'x'`,
          notNull: true
        },
        'pg'
      )
    ).toEqual([
      `ALTER TABLE "app"."t" ALTER COLUMN "a" TYPE text`,
      `ALTER TABLE "app"."t" ALTER COLUMN "a" SET DEFAULT 'x'`,
      `ALTER TABLE "app"."t" ALTER COLUMN "a" SET NOT NULL`
    ])
  })
  it('pg alterColumn: DROP DEFAULT / DROP NOT NULL', () => {
    expect(
      buildDdl(
        {
          kind: 'alterColumn',
          schema: 'app',
          table: 't',
          column: 'a',
          default: null,
          notNull: false
        },
        'pg'
      )
    ).toEqual([
      `ALTER TABLE "app"."t" ALTER COLUMN "a" DROP DEFAULT`,
      `ALTER TABLE "app"."t" ALTER COLUMN "a" DROP NOT NULL`
    ])
  })

  const struct = {
    columns: [
      { name: 'id', dataType: 'INTEGER', nullable: false, defaultValue: null, ordinal: 1 },
      { name: 'user_id', dataType: 'INTEGER', nullable: true, defaultValue: null, ordinal: 2 },
      { name: 'amt', dataType: 'REAL', nullable: true, defaultValue: null, ordinal: 3 }
    ],
    keys: [
      {
        name: 'primary',
        kind: 'primary' as const,
        columns: ['id'],
        referencedTable: null,
        referencedColumns: null
      },
      {
        name: 'fk_0',
        kind: 'foreign' as const,
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id']
      }
    ],
    indexes: [{ name: 'orders_uid', columns: ['user_id'], unique: false }]
  }
  it('sqlite alterColumn rebuild: preserves columns/FK/index, changes the type', () => {
    const stmts = buildDdl(
      { kind: 'alterColumn', schema: 'main', table: 'orders', column: 'amt', type: 'NUMERIC' },
      'sqlite',
      struct
    )
    expect(stmts[0]).toBe('PRAGMA defer_foreign_keys=ON')
    const create = stmts.find((s) => s.startsWith('CREATE TABLE'))!
    expect(create).toContain('"amt" NUMERIC')
    expect(create).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id")')
    expect(
      stmts.some((s) => s.startsWith('INSERT INTO') && s.includes('"id", "user_id", "amt"'))
    ).toBe(true)
    expect(stmts).toContain('DROP TABLE "main"."orders"')
    expect(stmts.some((s) => s.includes('RENAME TO "orders"'))).toBe(true)
    expect(stmts.some((s) => s.startsWith('CREATE INDEX') && s.includes('"orders_uid"'))).toBe(true)
  })
  it('sqlite addForeignKey rebuild adds the constraint', () => {
    const stmts = buildDdl(
      {
        kind: 'addForeignKey',
        spec: {
          schema: 'main',
          table: 'orders',
          name: 'fk_new',
          columns: ['user_id'],
          refSchema: 'main',
          refTable: 'users',
          refColumns: ['id']
        }
      },
      'sqlite',
      struct
    )
    // Existing FK + the new one both present (both reference users(id)).
    expect(stmts.find((s) => s.startsWith('CREATE TABLE'))!.match(/FOREIGN KEY/g)?.length).toBe(2)
  })
  it('sqlite rebuild op without context throws', () => {
    expect(() =>
      buildDdl(
        { kind: 'alterColumn', schema: 'main', table: 'orders', column: 'amt', type: 'NUMERIC' },
        'sqlite'
      )
    ).toThrow(/context/i)
  })
})

describe('reconstructDdl', () => {
  it('renders CREATE TABLE + indexes from introspection', () => {
    const ddl = reconstructDdl(
      [
        { name: 'id', dataType: 'integer', nullable: false, defaultValue: null, ordinal: 1 },
        { name: 'email', dataType: 'text', nullable: false, defaultValue: null, ordinal: 2 }
      ],
      [
        {
          name: 'primary',
          kind: 'primary',
          columns: ['id'],
          referencedTable: null,
          referencedColumns: null
        }
      ],
      [{ name: 'users_email_idx', columns: ['email'], unique: true }],
      'app',
      'users',
      'pg'
    )
    expect(ddl).toContain(`CREATE TABLE "app"."users" (`)
    expect(ddl).toContain(`"id" integer NOT NULL`)
    expect(ddl).toContain(`PRIMARY KEY ("id")`)
    expect(ddl).toContain(`CREATE UNIQUE INDEX "users_email_idx" ON "app"."users" ("email")`)
  })
})
