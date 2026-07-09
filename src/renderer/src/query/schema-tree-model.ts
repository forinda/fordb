// Pure model for the lazy schema tree. Kept free of React/react-arborist so it
// can be unit-tested: given the loaded schemas and a map of each expanded
// node's direct children, resolve the full nested tree; and map an invalidated
// introspection query key back to the tree node whose children it feeds.
//
// Hierarchy: schema → table nodes (directly) + category folders (Views/Functions/
// Triggers). Tables expand to columns; view/function/trigger objects are leaves
// (click opens a definition tab).

import type { ObjectKind } from '@shared/adapter/object-types'

export type CategoryKind = 'table' | ObjectKind
export type NodeKind = 'schema' | 'category' | 'table' | 'view' | 'function' | 'trigger' | 'column'

export interface TreeNode {
  id: string
  name: string
  kind: NodeKind
  schema: string
  table?: string
  /** For category folders: which kind they list. */
  category?: CategoryKind
  // `undefined` = leaf (column / object); an array (possibly empty) = expandable.
  children?: TreeNode[]
}

const isLeaf = (kind: NodeKind): boolean =>
  kind === 'column' || kind === 'view' || kind === 'function' || kind === 'trigger'

/**
 * Resolve the full tree from `schemas` (root) and `childrenById` (each expanded
 * node's DIRECT children). Recursive so a node picks up its children as soon as
 * they land in `childrenById`, instead of freezing at expand time.
 */
export function buildTree(schemas: string[], childrenById: Record<string, TreeNode[]>): TreeNode[] {
  const build = (id: string): TreeNode[] =>
    (childrenById[id] ?? []).map((k) => ({
      ...k,
      children: isLeaf(k.kind) ? undefined : build(k.id)
    }))
  return schemas.map((s) => ({
    id: `s:${s}`,
    name: s,
    kind: 'schema' as const,
    schema: s,
    children: build(`s:${s}`)
  }))
}

/**
 * Map an invalidated introspection query key to the tree node id whose children
 * it materializes, or null. Keys:
 *   ['conn', id, 'tables', schema]           → the schema's Tables category
 *   ['conn', id, 'objects', schema, kind]    → the schema's <kind> category
 *   ['conn', id, 'columns', schema, table]   → the table node
 */
export function invalidatedNodeId(key: readonly unknown[]): string | null {
  // Tables live directly under the schema node; object kinds under a category.
  if (key[2] === 'tables' && typeof key[3] === 'string') return `s:${key[3]}`
  if (key[2] === 'objects' && typeof key[3] === 'string' && typeof key[4] === 'string')
    return `cat:${key[3]}.${key[4]}`
  if (key[2] === 'columns' && typeof key[3] === 'string' && typeof key[4] === 'string')
    return `t:${key[3]}.${key[4]}`
  return null
}
