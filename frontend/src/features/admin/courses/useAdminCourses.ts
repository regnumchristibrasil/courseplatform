import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { CourseListRow } from '../../../contracts/adminCourses'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../auth/useAuth'
import { AdminCoursesApiError, listStaffCourses } from './api'
import { ADMIN_COURSES_QUERY_KEY } from './queryKeys'

// HTTP 401 (JWT inválido/expirado): encerra a sessão local; o ProtectedRoute
// redireciona para /login quando a sessão some.
export function useAdminCourses(): UseQueryResult<readonly CourseListRow[], Error> {
  const { signOut } = useAuth()
  const query = useQuery({
    queryKey: [...ADMIN_COURSES_QUERY_KEY, 'list'],
    queryFn: () => listStaffCourses(supabase),
  })
  const queryError = query.error

  useEffect(() => {
    if (!(queryError instanceof AdminCoursesApiError) || queryError.code !== 'unauthorized') return
    void signOut().then(({ error }) => {
      if (error) console.error('Failed to sign out after session expiry:', error)
    })
  }, [queryError, signOut])

  return query
}
