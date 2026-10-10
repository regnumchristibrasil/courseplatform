import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { AdminCoursesRequest, SaveCourseResponse } from '../../../contracts/adminCourses'
import { supabase } from '../../../lib/supabaseClient'
import { CURRENT_ACCESS_QUERY_KEY } from '../../authz/queryKeys'
import { AdminCoursesApiError, saveCourse } from './api'
import { ADMIN_COURSES_QUERY_KEY } from './queryKeys'
import { useUnauthorizedSignOut } from './useUnauthorizedSignOut'

// Pessimista: sem update otimista. Sucesso e conflito (stale_target) invalidam
// listas e detalhes, forçando a releitura; perda de acesso revalida o papel.
export function useSaveCourse(): UseMutationResult<SaveCourseResponse, Error, AdminCoursesRequest> {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (request: AdminCoursesRequest) => saveCourse(supabase, request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_COURSES_QUERY_KEY }),
    onError: (error) => {
      const code = error instanceof AdminCoursesApiError ? error.code : null
      if (code === 'stale_target' || code === 'not_found') {
        return queryClient.invalidateQueries({ queryKey: ADMIN_COURSES_QUERY_KEY })
      }
      if (code === 'forbidden') return queryClient.invalidateQueries({ queryKey: CURRENT_ACCESS_QUERY_KEY })
      return undefined
    },
  })
  useUnauthorizedSignOut(mutation.error)
  return mutation
}
