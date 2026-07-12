import { describe, it, expect } from 'vitest'
import { buildMaintenance, type MaintenanceOp } from '../../src/shared/ddl/maintenance'

describe('buildMaintenance', () => {
  const cases: [MaintenanceOp, string][] = [
    ['vacuum', 'VACUUM "app"."users"'],
    ['vacuumFull', 'VACUUM FULL "app"."users"'],
    ['analyze', 'ANALYZE "app"."users"'],
    ['reindex', 'REINDEX TABLE "app"."users"']
  ]
  it.each(cases)('%s → correct quoted statement', (op, sql) => {
    expect(buildMaintenance(op, 'app', 'users')).toBe(sql)
  })

  it('quotes identifiers that need it', () => {
    expect(buildMaintenance('analyze', 'My Schema', 'Odd Table')).toBe(
      `ANALYZE "My Schema"."Odd Table"`
    )
  })
})
