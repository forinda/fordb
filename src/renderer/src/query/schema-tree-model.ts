// Pure model for the lazy schema tree. Kept free of React/react-arborist so it
// can be unit-tested: given the loaded schemas and a map of each expanded
// node's direct children, resolve the full nested tree; and map an invalidated
// introspection query key back to the tree node whose children it feeds.

export type NodeKind = 'schema' | 'table' | 'view' | 'column'

export interface TreeNode {
  id: string
  name: string
  kind: NodeKind
  schema: string
  table?: string
  // `undefined` = leaf (column); an array (possibly empty) = expandable parent.
  children?: TreeNode[]
}

/**
 * Resolve the full tree from `schemas` (root) and `childrenById` (each expanded
 * node's DIRECT children — tables under a schema, columns under a table). The
 * resolution is recursive so a table node picks up its columns as soon as they
 * land in `childrenById`, instead of being frozen at schema-expand time.
 */
export function buildTree(schemas: string[], childrenById: Record<string, TreeNode[]>): TreeNode[] {
  const build = (id: string): TreeNode[] =>
    (childrenById[id] ?? []).map((k) => ({
      ...k,
      // Columns are leaves; schema/table nodes are expandable (empty until loaded).
      children: k.kind === 'column' ? undefined : build(k.id)
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
 * it materializes, or null if the key doesn't feed a loaded subtree. Keys look
 * like ['conn', connId, 'tables', schema] or ['conn', connId, 'columns', schema, table].
 */
export function invalidatedNodeId(key: readonly unknown[]): string | null {
  if (key[2] === 'tables' && typeof key[3] === 'string') return `s:${key[3]}`
  if (key[2] === 'columns' && typeof key[3] === 'string' && typeof key[4] === 'string')
    return `t:${key[3]}.${key[4]}`
  return null
}
