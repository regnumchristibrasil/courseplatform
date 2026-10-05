import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { SetRoleResponse } from '../../../contracts/adminUsers'
import { supabase } from '../../../lib/supabaseClient'
import { setUserRole, type SetRoleInput } from './api'
import { useSessionExpiryHandler } from './useSessionExpiryHandler'
import { invalidateOnMutationError, invalidateUsersList } from './invalidation'

// Pessimista: sem update otimista; invalida a lista após sucesso e em
// conflitos (stale_target / auth_sync_failed).
export function useSetUserRole(): UseMutationResult<SetRoleResponse, Error, SetRoleInput> {
  const queryClient = useQueryClient()
  const handleExpiry = useSessionExpiryHandler()
  return useMutation({
    mutationFn: (input: SetRoleInput) => setUserRole(supabase, input),
    onSuccess: () => invalidateUsersList(queryClient),
    onError: (error) => {
      handleExpiry(error)
      return invalidateOnMutationError(queryClient, error)
    },
  })
}
