import { useConnStore } from '../store'
import { useProfiles } from './profiles'

/** The active connection's SQL dialect + sql-formatter language, derived from the
 *  connected profile's engine (defaults to sqlite when unknown). */
export function useDialect(): { dialect: 'pg' | 'sqlite'; sqlLang: 'postgresql' | 'sqlite' } {
  const profileId = useConnStore((s) => s.activeProfileId)
  const { data: profiles = [] } = useProfiles()
  const pg = profiles.find((p) => p.id === profileId)?.engine === 'postgres'
  return { dialect: pg ? 'pg' : 'sqlite', sqlLang: pg ? 'postgresql' : 'sqlite' }
}
