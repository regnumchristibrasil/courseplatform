import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { CourseTree } from '../../../contracts/adminCourses'
import { supabase } from '../../../lib/supabaseClient'
import { getStaffCourse } from './api'
import { ADMIN_COURSES_QUERY_KEY } from './queryKeys'
import { useUnauthorizedSignOut } from './useUnauthorizedSignOut'

export function useAdminCourse(courseId: string): UseQueryResult<CourseTree, Error> {
  const query = useQuery({
    queryKey: [...ADMIN_COURSES_QUERY_KEY, 'detail', courseId],
    queryFn: () => getStaffCourse(supabase, courseId),
  })
  useUnauthorizedSignOut(query.error)
  return query
}
