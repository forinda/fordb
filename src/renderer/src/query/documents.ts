import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { hostApi } from '../rpc'

/** Whether the connection's engine exposes document-mode querying (MongoDB
 *  yes, Postgres/SQLite no). One-shot — no polling. Gates the doc-tab UI. */
export function useDocumentQuerySupported(connId: string | null): UseQueryResult<boolean> {
  return useQuery({
    queryKey: ['conn', connId ?? 'none', 'docQuerySupported'] as const,
    queryFn: async () => (await hostApi()).documentQuerySupported(connId!),
    enabled: !!connId
  })
}

interface DocsApi {
  fetchDocs(queryId: string): Promise<{ docs: Record<string, unknown>[]; done: boolean }>
  closeDocs(queryId: string): Promise<void>
}

/** Accumulates cursor-paged documents for one query. Mirrors QueryResultSource
 *  but pages Record<string,unknown>[] rather than unknown[][]. */
export class DocumentResultSource {
  docs: Record<string, unknown>[] = []
  done = false
  constructor(
    private readonly api: DocsApi,
    private readonly queryId: string
  ) {}
  async loadMore(): Promise<void> {
    if (this.done) return
    const page = await this.api.fetchDocs(this.queryId)
    this.docs = this.docs.concat(page.docs)
    this.done = page.done
  }
  dispose(): Promise<void> {
    return this.api.closeDocs(this.queryId)
  }
}
