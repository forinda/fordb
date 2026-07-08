import type { FieldInfo, Page } from '../../../shared/adapter/types'

export interface QueryApi {
  fetchPage(queryId: string): Promise<Page>
  closeQuery(queryId: string): Promise<void>
}

export class QueryResultSource {
  private rows: unknown[][] = []
  private isDone = false
  private inflight: Promise<void> | null = null

  constructor(
    private readonly api: QueryApi,
    private readonly queryId: string,
    readonly fields: FieldInfo[],
    readonly pageSize: number
  ) {}

  loadedRowCount(): number {
    return this.rows.length
  }
  done(): boolean {
    return this.isDone
  }
  getRow(i: number): unknown[] | undefined {
    return this.rows[i]
  }

  private async fetchOne(): Promise<void> {
    if (this.isDone) return
    const page = await this.api.fetchPage(this.queryId)
    this.rows.push(...page.rows)
    if (page.done) this.isDone = true
  }

  /** Load pages until at least uptoIndex is available (or done). Serialized. */
  async ensureLoaded(uptoIndex: number): Promise<void> {
    while (!this.isDone && this.rows.length <= uptoIndex) {
      this.inflight = (this.inflight ?? Promise.resolve()).then(() => this.fetchOne())
      await this.inflight
    }
  }

  async drainAll(): Promise<void> {
    while (!this.isDone) {
      this.inflight = (this.inflight ?? Promise.resolve()).then(() => this.fetchOne())
      await this.inflight
    }
  }

  async dispose(): Promise<void> {
    await this.api.closeQuery(this.queryId).catch(() => undefined)
  }
}
