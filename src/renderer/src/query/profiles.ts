import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ConnectionProfile } from '@shared/adapter/types'
import { qk } from './keys'

export function useProfiles(): UseQueryResult<ConnectionProfile[]> {
  return useQuery({ queryKey: qk.profiles(), queryFn: () => window.fordb.profiles.list() })
}

export function useInvalidateProfiles(): () => void {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: qk.profiles() })
  }
}
