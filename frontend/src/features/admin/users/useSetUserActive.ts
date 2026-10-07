import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { SetActiveRequest, SetActiveResponse } from '../../../contracts/adminUsers'
import { supabase } from '../../../lib/supabaseClient'
import { setUserActive } from './api'
import { useSessionExpiryHandler } from './useSessionExpiryHandler'
import { invalidateOnMutationError, invalidateUsersList } from './invalidation'

// Pessimista: sem update otimista; invalida a lista após sucesso e em
// conflitos (stale_target / auth_sync_failed).
export function useSetUserActive(): UseMutationResult<SetActiveResponse, Error, SetActiveRequest> {
  const queryClient = useQueryClient()
  const handleExpiry = useSessionExpiryHandler()
  return useMutation({
    mutationFn: (input: SetActiveRequest) => setUserActive(supabase, input),
    onSuccess: () => invalidateUsersList(queryClient),
    onError: (error) => {
      handleExpiry(error)
      return invalidateOnMutationError(queryClient, error)
    },
  })
}
