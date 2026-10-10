import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { CourseListRow } from '../../../contracts/adminCourses'
import { supabase } from '../../../lib/supabaseClient'
import { listStaffCourses } from './api'
import { ADMIN_COURSES_QUERY_KEY } from './queryKeys'
import { useUnauthorizedSignOut } from './useUnauthorizedSignOut'

export function useAdminCourses(): UseQueryResult<readonly CourseListRow[], Error> {
  const query = useQuery({
    queryKey: [...ADMIN_COURSES_QUERY_KEY, 'list'],
    queryFn: () => listStaffCourses(supabase),
  })
  useUnauthorizedSignOut(query.error)
  return query
}
