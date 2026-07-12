/** Serialize fetched documents for export. `json` = a pretty-printed array;
 *  `ndjson` = one compact JSON document per line (mongoexport's default). */
export function formatDocsExport(
  docs: Record<string, unknown>[],
  format: 'json' | 'ndjson'
): string {
  return format === 'ndjson'
    ? docs.map((d) => JSON.stringify(d)).join('\n')
    : JSON.stringify(docs, null, 2)
}
