import type { QueryClient } from '@tanstack/react-query'
import { CURRENT_ACCESS_QUERY_KEY } from '../../authz/queryKeys'
import { AdminUsersApiError } from './api'
import { ADMIN_USERS_QUERY_KEY } from './queryKeys'

export function invalidateUsersList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ADMIN_USERS_QUERY_KEY })
}

// Erros que indicam que a lista exibida está desatualizada: stale_target
// (outra pessoa alterou o alvo) e auth_sync_failed (o flag já foi gravado).
const STALE_LIST_CODES: readonly string[] = ['stale_target', 'auth_sync_failed']

export function invalidateListOnConflict(queryClient: QueryClient, error: unknown): Promise<void> {
  const stale = error instanceof AdminUsersApiError && STALE_LIST_CODES.includes(error.code)
  return stale ? invalidateUsersList(queryClient) : Promise.resolve()
}

// 403 por perda de acesso: o papel/status do ator mudou, então revalida ['me'].
export function invalidateMeOnAccessLoss(queryClient: QueryClient, error: unknown): Promise<void> {
  const lost = error instanceof AdminUsersApiError &&
    (error.code === 'forbidden' || error.code === 'actor_inactive')
  return lost ? queryClient.invalidateQueries({ queryKey: CURRENT_ACCESS_QUERY_KEY }) : Promise.resolve()
}

export async function invalidateOnMutationError(queryClient: QueryClient, error: unknown): Promise<void> {
  await Promise.all([invalidateListOnConflict(queryClient, error), invalidateMeOnAccessLoss(queryClient, error)])
}
