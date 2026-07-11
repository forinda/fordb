import { describe, it, expect } from 'vitest'
import { buildTableSpec, type ColRow } from '../../src/shared/ddl/table-spec'
import { buildDdl } from '../../src/shared/ddl/build-ddl'

const col = (over: Partial<ColRow> = {}): ColRow => ({
  name: '',
  type: '',
  nullable: true,
  pk: false,
  unique: false,
  default: '',
  ...over
})

describe('buildTableSpec', () => {
  it('drops nameless/typeless rows, collects PK, marks unique + NOT NULL', () => {
    const spec = buildTableSpec(
      [
        col({ name: 'id', type: 'integer', nullable: false, pk: true }),
        col({ name: 'sku', type: 'text', unique: true }),
        col({ name: '', type: 'text' }) // dropped
      ],
      [],
      'orders',
      'app',
      'pg'
    )
    expect(spec.columns).toEqual([
      { name: 'id', type: 'integer', notNull: true, default: undefined, unique: undefined },
      { name: 'sku', type: 'text', notNull: false, default: undefined, unique: true }
    ])
    expect(spec.primaryKey).toEqual(['id'])
    expect(spec.foreignKeys).toBeUndefined()
  })

  it('assembles an inline FK with an auto name, and produces valid pg DDL', () => {
    const spec = buildTableSpec(
      [col({ name: 'customer_id', type: 'integer' })],
      [
        {
          name: '',
          columns: ['customer_id'],
          refSchema: 'app',
          refTable: 'customers',
          refColumns: ['id']
        }
      ],
      'orders',
      'app',
      'pg'
    )
    expect(spec.foreignKeys).toEqual([
      {
        name: 'fk_orders_customer_id',
        columns: ['customer_id'],
        refSchema: 'app',
        refTable: 'customers',
        refColumns: ['id']
      }
    ])
    expect(buildDdl({ kind: 'createTable', spec }, 'pg')[0]).toContain(
      'CONSTRAINT "fk_orders_customer_id" FOREIGN KEY ("customer_id") REFERENCES "app"."customers" ("id")'
    )
  })

  it('sqlite drops the FK refSchema (no cross-schema FK in a table body)', () => {
    const spec = buildTableSpec(
      [col({ name: 'customer_id', type: 'INTEGER' })],
      [
        {
          name: 'fk_x',
          columns: ['customer_id'],
          refSchema: 'main',
          refTable: 'customers',
          refColumns: ['id']
        }
      ],
      'orders',
      'main',
      'sqlite'
    )
    expect(spec.foreignKeys?.[0]?.refSchema).toBeUndefined()
  })
})
