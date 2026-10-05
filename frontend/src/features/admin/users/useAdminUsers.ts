import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ListUsersResponse } from '../../../contracts/adminUsers'
import { supabase } from '../../../lib/supabaseClient'
import { listAdminUsers } from './api'
import { parseFilters, toListRequest, toSearchParams, type AdminUsersFilters } from './filters'
import { ADMIN_USERS_QUERY_KEY } from './queryKeys'
import { useSessionExpiryHandler } from './useSessionExpiryHandler'

export type AdminUsersFilterPatch = Partial<AdminUsersFilters>

export interface SetFiltersOptions {
  // Substitui a entrada atual do histórico em vez de empilhar uma nova.
  readonly replace?: boolean
}

export interface UseAdminUsersResult {
  readonly filters: AdminUsersFilters
  readonly setFilters: (patch: AdminUsersFilterPatch, options?: SetFiltersOptions) => void
  readonly query: UseQueryResult<ListUsersResponse, Error>
}

// Mudar qualquer filtro (exceto a própria página) volta para a página 1.
function applyPatch(current: AdminUsersFilters, patch: AdminUsersFilterPatch): AdminUsersFilters {
  const merged = { ...current, ...patch }
  return 'page' in patch ? merged : { ...merged, page: 1 }
}

export function useAdminUsers(): UseAdminUsersResult {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => parseFilters(params), [params])
  const request = useMemo(() => toListRequest(filters), [filters])

  const setFilters = useCallback(
    (patch: AdminUsersFilterPatch, options: SetFiltersOptions = {}) => {
      setParams((prev) => toSearchParams(applyPatch(parseFilters(prev), patch)), { replace: options.replace === true })
    },
    [setParams],
  )

  const query = useQuery({
    queryKey: [...ADMIN_USERS_QUERY_KEY, 'list', request],
    queryFn: () => listAdminUsers(supabase, request),
    placeholderData: keepPreviousData,
  })

  const handleExpiry = useSessionExpiryHandler()
  const queryError = query.error
  useEffect(() => {
    if (queryError) handleExpiry(queryError)
  }, [queryError, handleExpiry])

  return { filters, setFilters, query }
}
