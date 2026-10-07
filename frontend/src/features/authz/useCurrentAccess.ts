import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { CurrentAccess } from '../../contracts/adminUsers'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../auth/useAuth'
import { currentAccessKey } from './queryKeys'
import { fetchCurrentAccess } from './currentAccessApi'

// Papel/status mudam raramente, mas um admin rebaixado deve perder a UI logo.
const CURRENT_ACCESS_STALE_TIME_MS = 10_000

// O cache é limpo pelo AuthProvider no signOut / troca de usuário. A query só
// é habilitada com usuário: sem sessão o RPC responderia 401 (ver currentAccessApi).
export function useCurrentAccess(): UseQueryResult<CurrentAccess | null, Error> {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  return useQuery({
    queryKey: currentAccessKey(userId),
    queryFn: () => fetchCurrentAccess(supabase),
    enabled: user !== null,
    staleTime: CURRENT_ACCESS_STALE_TIME_MS,
  })
}
