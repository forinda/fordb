import { quoteIdent } from '../mutation/build-edits'

export type MaintenanceOp = 'vacuum' | 'vacuumFull' | 'analyze' | 'reindex'

const qi = quoteIdent

/** Postgres table-maintenance statements. VACUUM/REINDEX cannot run inside a
 *  transaction, so callers run these via executeQuery (autocommit), not applyDdl. */
export function buildMaintenance(op: MaintenanceOp, schema: string, table: string): string {
  const t = `${qi(schema)}.${qi(table)}`
  switch (op) {
    case 'vacuum':
      return `VACUUM ${t}`
    case 'vacuumFull':
      return `VACUUM FULL ${t}`
    case 'analyze':
      return `ANALYZE ${t}`
    case 'reindex':
      return `REINDEX TABLE ${t}`
  }
}

export const MAINTENANCE_LABELS: { op: MaintenanceOp; label: string }[] = [
  { op: 'vacuum', label: 'Vacuum' },
  { op: 'vacuumFull', label: 'Vacuum full' },
  { op: 'analyze', label: 'Analyze' },
  { op: 'reindex', label: 'Reindex' }
]
