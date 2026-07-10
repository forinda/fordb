import { describe, it, expect } from 'vitest'
import { filterProfiles } from '../../src/shared/profile-filter'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

const pg = (id: string, extra: object = {}): ConnectionProfile => ({
  id,
  name: `pg-${id}`,
  engine: 'postgres',
  host: 'db.acme.io',
  port: 5432,
  database: 'app',
  user: 'u',
  ...extra
})
const lite = (id: string, extra: object = {}): ConnectionProfile => ({
  id,
  name: `lite-${id}`,
  engine: 'sqlite',
  kind: 'local',
  file: `/tmp/${id}.db`,
  ...extra
})
const all = [
  pg('1', { environment: 'production', favorite: true }),
  pg('2', { environment: 'staging' }),
  lite('3', { favorite: true }),
  lite('4')
]

describe('filterProfiles', () => {
  it('empty filter returns all', () => {
    expect(filterProfiles(all, {})).toHaveLength(4)
  })
  it('narrows by engine', () => {
    expect(filterProfiles(all, { engine: 'sqlite' }).map((p) => p.id)).toEqual(['3', '4'])
  })
  it('narrows by environment', () => {
    expect(filterProfiles(all, { environment: 'production' }).map((p) => p.id)).toEqual(['1'])
  })
  it('narrows to favorites', () => {
    expect(filterProfiles(all, { favoritesOnly: true }).map((p) => p.id)).toEqual(['1', '3'])
  })
  it('search matches name and label, case-insensitive', () => {
    expect(filterProfiles(all, { search: 'PG-1' }).map((p) => p.id)).toEqual(['1'])
    expect(filterProfiles(all, { search: 'acme' }).length).toBeGreaterThan(0)
  })
  it('composes engine + favorites', () => {
    expect(
      filterProfiles(all, { engine: 'postgres', favoritesOnly: true }).map((p) => p.id)
    ).toEqual(['1'])
  })
})
