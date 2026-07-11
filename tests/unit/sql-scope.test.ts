import { describe, it, expect } from 'vitest'
import { parseFromTables, resolveTable } from '../../src/renderer/src/query/sql-scope'

describe('parseFromTables', () => {
  it('single table, no alias', () => {
    expect(parseFromTables('SELECT * FROM orders')).toEqual([{ table: 'orders' }])
  })
  it('table with a bare alias', () => {
    expect(parseFromTables('SELECT o.id FROM orders o')).toEqual([{ table: 'orders', alias: 'o' }])
  })
  it('table with an AS alias (case-insensitive)', () => {
    expect(parseFromTables('select * from orders AS o')).toEqual([{ table: 'orders', alias: 'o' }])
  })
  it('multiple JOINs with aliases', () => {
    const sql =
      'SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id JOIN items i ON i.order_id = o.id'
    expect(parseFromTables(sql)).toEqual([
      { table: 'orders', alias: 'o' },
      { table: 'customers', alias: 'c' },
      { table: 'items', alias: 'i' }
    ])
  })
  it('schema-qualified name keeps the last segment as table, aliased', () => {
    expect(parseFromTables('SELECT * FROM app.orders o')).toEqual([{ table: 'orders', alias: 'o' }])
  })
  it('no FROM clause → empty', () => {
    expect(parseFromTables('SELECT 1')).toEqual([])
  })
  it('does not treat ON / WHERE / JOIN keywords as aliases', () => {
    expect(parseFromTables('SELECT * FROM orders WHERE id = 1')).toEqual([{ table: 'orders' }])
    expect(
      parseFromTables('SELECT * FROM orders o JOIN customers ON o.cid = customers.id')
    ).toEqual([{ table: 'orders', alias: 'o' }, { table: 'customers' }])
  })
})

describe('resolveTable', () => {
  const from = [{ table: 'orders', alias: 'o' }, { table: 'customers' }]
  it('resolves an alias to its table', () => {
    expect(resolveTable('o', from)).toBe('orders')
  })
  it('resolves a bare table name to itself', () => {
    expect(resolveTable('customers', from)).toBe('customers')
  })
  it('unknown prefix falls back to the prefix', () => {
    expect(resolveTable('x', from)).toBe('x')
  })
})
