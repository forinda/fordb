import { describe, it, expect } from 'vitest'
import {
  buildTableSpec,
  buildIndexChanges,
  duplicateColumnNames,
  type ColRow,
  type FkRow,
  type IdxRow
} from '../../src/shared/ddl/table-spec'
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
          refSchema: 'app',
          refTable: 'customers',
          pairs: [{ local: 'customer_id', ref: 'id' }]
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
          refSchema: 'main',
          refTable: 'customers',
          pairs: [{ local: 'customer_id', ref: 'id' }]
        }
      ],
      'orders',
      'main',
      'sqlite'
    )
    expect(spec.foreignKeys?.[0]?.refSchema).toBeUndefined()
  })
})

describe('buildTableSpec — multi-column FK pairs', () => {
  const idCol = (name: string): ColRow => ({
    name,
    type: 'integer',
    nullable: true,
    pk: false,
    unique: false,
    default: ''
  })

  it('maps ordered pairs to composite columns/refColumns (pg)', () => {
    const fk: FkRow = {
      name: 'fk_o_c',
      refSchema: 'app',
      refTable: 'customers',
      pairs: [
        { local: 'tenant_id', ref: 'tenant_id' },
        { local: 'customer_id', ref: 'id' }
      ]
    }
    const spec = buildTableSpec(
      [idCol('tenant_id'), idCol('customer_id')],
      [fk],
      'orders',
      'app',
      'pg'
    )
    expect(spec.foreignKeys).toEqual([
      {
        name: 'fk_o_c',
        columns: ['tenant_id', 'customer_id'],
        refSchema: 'app',
        refTable: 'customers',
        refColumns: ['tenant_id', 'id']
      }
    ])
    expect(buildDdl({ kind: 'createTable', spec }, 'pg')[0]).toContain(
      'CONSTRAINT "fk_o_c" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "app"."customers" ("tenant_id", "id")'
    )
  })

  it('drops pairs with an empty side and FK rows with no complete pair', () => {
    const fks: FkRow[] = [
      {
        name: '',
        refSchema: 'app',
        refTable: 'customers',
        pairs: [
          { local: 'customer_id', ref: 'id' },
          { local: 'x', ref: '' }
        ]
      },
      { name: '', refSchema: 'app', refTable: 'customers', pairs: [{ local: '', ref: '' }] }
    ]
    const spec = buildTableSpec([idCol('customer_id')], fks, 'orders', 'app', 'pg')
    expect(spec.foreignKeys).toEqual([
      {
        name: 'fk_orders_customer_id',
        columns: ['customer_id'],
        refSchema: 'app',
        refTable: 'customers',
        refColumns: ['id']
      }
    ])
  })
})

describe('buildIndexChanges', () => {
  const idx = (over: Partial<IdxRow>): IdxRow => ({
    name: '',
    columns: [],
    unique: false,
    ...over
  })

  it('single + multi column, unique, auto-name; drops empty', () => {
    const changes = buildIndexChanges(
      [
        idx({ columns: ['email'], unique: true }),
        idx({ name: 'orders_ci', columns: ['customer_id', 'placed_at'] }),
        idx({ columns: [''] })
      ],
      'app',
      'orders'
    )
    expect(changes).toEqual([
      {
        kind: 'createIndex',
        spec: {
          schema: 'app',
          table: 'orders',
          name: 'idx_orders_email',
          columns: ['email'],
          unique: true
        }
      },
      {
        kind: 'createIndex',
        spec: {
          schema: 'app',
          table: 'orders',
          name: 'orders_ci',
          columns: ['customer_id', 'placed_at'],
          unique: undefined
        }
      }
    ])
    expect(buildDdl(changes[0]!, 'pg')[0]).toBe(
      'CREATE UNIQUE INDEX "idx_orders_email" ON "app"."orders" ("email")'
    )
  })
})

describe('duplicateColumnNames', () => {
  it('reports trimmed non-empty names appearing more than once', () => {
    expect(
      duplicateColumnNames([
        col({ name: 'id' }),
        col({ name: 'id ' }),
        col({ name: 'name' }),
        col({ name: '' }),
        col({ name: '' })
      ])
    ).toEqual(['id'])
  })
  it('empty when all names are distinct', () => {
    expect(duplicateColumnNames([col({ name: 'a' }), col({ name: 'b' })])).toEqual([])
  })
})
