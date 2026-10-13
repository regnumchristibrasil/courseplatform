import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { CourseTree } from '../../contracts/studentArea'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../auth/useAuth'
import { fetchCourseTree } from './courseTreeApi'
import { courseTreeKey } from './queryKeys'

// A chave inclui o usuário: trocar de conta nunca reaproveita o cache anterior.
export function useCourseTree(courseId: string): UseQueryResult<CourseTree | null, Error> {
  const { user } = useAuth()
  return useQuery({
    queryKey: courseTreeKey(user?.id ?? '', courseId),
    queryFn: () => fetchCourseTree(supabase, courseId),
    enabled: user !== null && courseId !== '',
  })
}
