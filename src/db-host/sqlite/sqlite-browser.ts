import type { DataBrowser, BrowseOptions } from '@shared/adapter/browse-types'
import type { OpenQueryResult } from '@shared/adapter/types'
import { buildBrowseSql } from '@shared/browse/build-browse'

export class SqliteDataBrowser implements DataBrowser {
  constructor(
    private readonly open: (
      sql: string,
      params: unknown[],
      pageSize: number
    ) => Promise<OpenQueryResult>
  ) {}

  openBrowse(opts: BrowseOptions): Promise<OpenQueryResult> {
    const { sql, params } = buildBrowseSql(opts, 'sqlite')
    return this.open(sql, params, opts.pageSize)
  }
}
