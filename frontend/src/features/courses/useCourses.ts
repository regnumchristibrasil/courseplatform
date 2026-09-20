import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { fetchPublishedCourses } from './coursesApi'
import type { CoursePublic } from './types'

export const COURSES_QUERY_KEY = ['courses', 'published'] as const

export function useCourses(): UseQueryResult<readonly CoursePublic[], Error> {
  return useQuery({
    queryKey: COURSES_QUERY_KEY,
    queryFn: () => fetchPublishedCourses(supabase),
  })
}
