import { describe, it, expect } from 'vitest'
import {
  buildTree,
  invalidatedNodeId,
  type TreeNode
} from '../../src/renderer/src/query/schema-tree-model'

describe('buildTree', () => {
  it('resolves a table node’s columns once they are loaded (not frozen at schema-expand)', () => {
    const childrenById: Record<string, TreeNode[]> = {
      's:app': [{ id: 't:app.users', name: 'users', kind: 'table', schema: 'app', table: 'users' }],
      't:app.users': [
        { id: 'c:app.users.id', name: 'id', kind: 'column', schema: 'app', table: 'users' }
      ]
    }
    const tree = buildTree(['app'], childrenById)
    const users = tree[0]!.children![0]!
    expect(users.name).toBe('users')
    // The regression: this used to be [] because the schema's stored table node
    // was built before the columns loaded.
    expect(users.children).toHaveLength(1)
    expect(users.children![0]!.name).toBe('id')
    // Columns are leaves.
    expect(users.children![0]!.children).toBeUndefined()
  })

  it('shows an unloaded schema/table as an expandable (empty) parent', () => {
    const tree = buildTree(['app'], {})
    expect(tree[0]!.children).toEqual([])
  })
})

describe('invalidatedNodeId', () => {
  it('maps a tables key to its schema node', () => {
    expect(invalidatedNodeId(['conn', 'c1', 'tables', 'app'])).toBe('s:app')
  })
  it('maps a columns key to its table node', () => {
    expect(invalidatedNodeId(['conn', 'c1', 'columns', 'app', 'users'])).toBe('t:app.users')
  })
  it('returns null for schemas and other keys', () => {
    expect(invalidatedNodeId(['conn', 'c1', 'schemas'])).toBeNull()
    expect(invalidatedNodeId(['profiles'])).toBeNull()
  })
})
