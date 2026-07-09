import { describe, it, expect } from 'vitest'
import {
  quoteIdent,
  renderLiteral,
  previewEdit,
  buildEdits
} from '../../src/shared/mutation/build-edits'
import type { RowEdit } from '../../src/shared/adapter/mutation-types'

describe('quoteIdent', () => {
  it('quotes and doubles embedded quotes', () => {
    expect(quoteIdent('users')).toBe('"users"')
    expect(quoteIdent('we"ird')).toBe('"we""ird"')
  })
})

describe('renderLiteral', () => {
  it('renders NULL, numbers, booleans, escaped strings', () => {
    expect(renderLiteral(null)).toBe('NULL')
    expect(renderLiteral(undefined)).toBe('NULL')
    expect(renderLiteral(42)).toBe('42')
    expect(renderLiteral(true)).toBe('true')
    expect(renderLiteral("O'Brien")).toBe("'O''Brien'")
  })
})

describe('previewEdit', () => {
  it('renders an UPDATE with SET + WHERE', () => {
    const e: RowEdit = {
      kind: 'update',
      schema: 'app',
      table: 'users',
      pk: [{ column: 'id', value: 1 }],
      set: [
        { column: 'name', value: 'Bob' },
        { column: 'email', value: null }
      ]
    }
    expect(previewEdit(e)).toBe(
      `UPDATE "app"."users" SET "name" = 'Bob', "email" = NULL WHERE "id" = 1`
    )
  })
  it('renders an INSERT', () => {
    const e: RowEdit = {
      kind: 'insert',
      schema: 'app',
      table: 'users',
      values: [
        { column: 'email', value: 'a@x' },
        { column: 'name', value: 'A' }
      ]
    }
    expect(previewEdit(e)).toBe(`INSERT INTO "app"."users" ("email", "name") VALUES ('a@x', 'A')`)
  })
  it('renders a DELETE', () => {
    const e: RowEdit = {
      kind: 'delete',
      schema: 'app',
      table: 'users',
      pk: [{ column: 'id', value: 2 }]
    }
    expect(previewEdit(e)).toBe(`DELETE FROM "app"."users" WHERE "id" = 2`)
  })
})

describe('buildEdits', () => {
  it('assembles updates/inserts/deletes with schema+table', () => {
    const out = buildEdits({
      schema: 'app',
      table: 'users',
      updates: [{ pk: [{ column: 'id', value: 1 }], set: [{ column: 'name', value: 'X' }] }],
      inserts: [{ values: [{ column: 'name', value: 'N' }] }],
      deletes: [{ pk: [{ column: 'id', value: 3 }] }]
    })
    expect(out).toEqual([
      {
        kind: 'update',
        schema: 'app',
        table: 'users',
        pk: [{ column: 'id', value: 1 }],
        set: [{ column: 'name', value: 'X' }]
      },
      { kind: 'insert', schema: 'app', table: 'users', values: [{ column: 'name', value: 'N' }] },
      { kind: 'delete', schema: 'app', table: 'users', pk: [{ column: 'id', value: 3 }] }
    ])
  })
})
