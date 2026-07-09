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
  it('sqlite dropIndex omits the schema qualifier', () => {
    expect(buildDdl({ kind: 'dropIndex', schema: 'main', name: 'i' }, 'sqlite')).toEqual([
      `DROP INDEX "i"`
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
  it('quotes identifiers with embedded quotes', () => {
    expect(buildDdl({ kind: 'dropTable', schema: 'a"b', table: 't"x' }, 'pg')).toEqual([
      `DROP TABLE "a""b"."t""x"`
    ])
  })
})

describe('reconstructDdl', () => {
  it('renders CREATE TABLE + indexes from introspection', () => {
    const ddl = reconstructDdl(
      [
        { name: 'id', dataType: 'integer', nullable: false, defaultValue: null, ordinal: 1 },
        { name: 'email', dataType: 'text', nullable: false, defaultValue: null, ordinal: 2 }
      ],
      [{ name: 'primary', kind: 'primary', columns: ['id'], referencedTable: null }],
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
