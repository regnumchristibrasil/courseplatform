import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { MyCourse } from '../../contracts/studentArea'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../auth/useAuth'
import { fetchMyCourses } from './myCoursesApi'
import { myCoursesKey } from './queryKeys'

// A chave inclui o usuário: trocar de conta nunca reaproveita o cache anterior.
export function useMyCourses(): UseQueryResult<readonly MyCourse[], Error> {
  const { user } = useAuth()
  return useQuery({
    queryKey: myCoursesKey(user?.id ?? ''),
    queryFn: () => fetchMyCourses(supabase),
    enabled: user !== null,
  })
}
