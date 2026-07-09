import { describe, it, expect } from 'vitest'
import {
  buildTree,
  invalidatedNodeId,
  type TreeNode
} from '../../src/renderer/src/query/schema-tree-model'

describe('buildTree', () => {
  it('nests schema → category → objects; tables expand to columns, objects are leaves', () => {
    const childrenById: Record<string, TreeNode[]> = {
      's:app': [
        { id: 'cat:app.table', name: 'Tables', kind: 'category', schema: 'app', category: 'table' },
        { id: 'cat:app.view', name: 'Views', kind: 'category', schema: 'app', category: 'view' }
      ],
      'cat:app.table': [
        { id: 't:app.users', name: 'users', kind: 'table', schema: 'app', table: 'users' }
      ],
      'cat:app.view': [{ id: 'obj:app.view.v1', name: 'v1', kind: 'view', schema: 'app' }],
      't:app.users': [
        { id: 'c:app.users.id', name: 'id', kind: 'column', schema: 'app', table: 'users' }
      ]
    }
    const schema = buildTree(['app'], childrenById)[0]!
    expect(schema.kind).toBe('schema')
    const [tables, views] = schema.children!
    expect(tables!.name).toBe('Tables')
    // table node picks up columns once loaded (not frozen at expand)
    const users = tables!.children![0]!
    expect(users.name).toBe('users')
    expect(users.children![0]!.name).toBe('id')
    expect(users.children![0]!.children).toBeUndefined() // column is a leaf
    // a view object is a leaf
    expect(views!.children![0]!.name).toBe('v1')
    expect(views!.children![0]!.children).toBeUndefined()
  })

  it('shows an unloaded schema as an expandable (empty) parent', () => {
    expect(buildTree(['app'], {})[0]!.children).toEqual([])
  })
})

describe('invalidatedNodeId', () => {
  it('maps tables/objects/columns keys to the right node ids', () => {
    expect(invalidatedNodeId(['conn', 'c1', 'tables', 'app'])).toBe('cat:app.table')
    expect(invalidatedNodeId(['conn', 'c1', 'objects', 'app', 'view'])).toBe('cat:app.view')
    expect(invalidatedNodeId(['conn', 'c1', 'columns', 'app', 'users'])).toBe('t:app.users')
  })
  it('returns null for schemas and other keys', () => {
    expect(invalidatedNodeId(['conn', 'c1', 'schemas'])).toBeNull()
    expect(invalidatedNodeId(['profiles'])).toBeNull()
  })
})
