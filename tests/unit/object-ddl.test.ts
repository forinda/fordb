import { describe, it, expect } from 'vitest'
import {
  buildDropObject,
  functionTemplate,
  triggerTemplate,
  sequenceTemplate,
  matviewTemplate,
  refreshMatview
} from '../../src/shared/ddl/object-ddl'

describe('buildDropObject', () => {
  it('drops a view / function with a qualified quoted name', () => {
    expect(buildDropObject('view', 'app', 'active_users')).toBe(`DROP VIEW "app"."active_users"`)
    expect(buildDropObject('function', 'app', 'do_thing')).toBe(`DROP FUNCTION "app"."do_thing"`)
  })

  it('drops a trigger with the table parsed from its definition', () => {
    const def = `CREATE TRIGGER set_updated BEFORE UPDATE ON app.users FOR EACH ROW EXECUTE FUNCTION touch()`
    expect(buildDropObject('trigger', 'app', 'set_updated', def)).toBe(
      `DROP TRIGGER "set_updated" ON app.users`
    )
  })

  it('parses a quoted table name in a trigger definition', () => {
    const def = `CREATE TRIGGER t AFTER INSERT ON "app"."My Table" FOR EACH ROW EXECUTE FUNCTION f()`
    expect(buildDropObject('trigger', 'app', 't', def)).toBe(`DROP TRIGGER "t" ON "app"."My Table"`)
  })

  it('falls back to schema.name when a trigger table cannot be parsed', () => {
    // No usable definition — best effort so the menu item still does something.
    expect(buildDropObject('trigger', 'app', 't')).toBe(`DROP TRIGGER "t" ON "app".<table>`)
  })

  it('drops a sequence and a materialized view', () => {
    expect(buildDropObject('sequence', 'app', 'order_id_seq')).toBe(
      `DROP SEQUENCE "app"."order_id_seq"`
    )
    expect(buildDropObject('materializedView', 'app', 'daily')).toBe(
      `DROP MATERIALIZED VIEW "app"."daily"`
    )
  })
})

describe('refreshMatview', () => {
  it('builds a qualified REFRESH MATERIALIZED VIEW', () => {
    expect(refreshMatview('app', 'daily')).toBe(`REFRESH MATERIALIZED VIEW "app"."daily"`)
  })
})

describe('templates', () => {
  it('function template is a CREATE OR REPLACE FUNCTION in the schema', () => {
    expect(functionTemplate('app')).toContain('CREATE OR REPLACE FUNCTION "app".')
    expect(functionTemplate('app')).toContain('LANGUAGE')
  })
  it('trigger template is a CREATE TRIGGER referencing the schema', () => {
    expect(triggerTemplate('app')).toContain('CREATE TRIGGER')
    expect(triggerTemplate('app')).toContain('"app".')
  })
  it('sequence + matview templates are CREATE statements in the schema', () => {
    expect(sequenceTemplate('app')).toContain('CREATE SEQUENCE "app".')
    expect(matviewTemplate('app')).toContain('CREATE MATERIALIZED VIEW "app".')
    expect(matviewTemplate('app')).toContain('WITH DATA')
  })
})
