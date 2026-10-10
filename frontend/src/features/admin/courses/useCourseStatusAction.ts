import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { CourseStatus } from '../../../contracts/adminCourses'
import { supabase } from '../../../lib/supabaseClient'
import { CURRENT_ACCESS_QUERY_KEY } from '../../authz/queryKeys'
import { AdminCoursesApiError, deleteCourse, setCourseStatus } from './api'
import { ADMIN_COURSES_QUERY_KEY } from './queryKeys'
import { useUnauthorizedSignOut } from './useUnauthorizedSignOut'

// Operações sobre o curso carregam o updated_at lido (token do locking otimista).
export type CourseStatusOperation =
  | { readonly kind: 'status'; readonly courseId: string; readonly expectedUpdatedAt: string; readonly status: CourseStatus }
  | { readonly kind: 'delete'; readonly courseId: string; readonly expectedUpdatedAt: string }

// publish_gate_violated não relê: nada mudou no servidor e a lista de pendências
// continua valendo para a árvore que está na tela.
const REFRESH_CODES: readonly string[] = ['stale_target', 'not_found', 'invalid_transition', 'course_has_sales']

async function run(operation: CourseStatusOperation): Promise<void> {
  if (operation.kind === 'delete') return deleteCourse(supabase, operation.courseId, operation.expectedUpdatedAt)
  await setCourseStatus(supabase, operation.courseId, operation.expectedUpdatedAt, operation.status)
}

// Pessimista, como useSaveCourse: sucesso e erros de estado releem a árvore;
// perda de acesso revalida o papel.
export function useCourseStatusAction(): UseMutationResult<void, Error, CourseStatusOperation> {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ADMIN_COURSES_QUERY_KEY })
  const mutation = useMutation({
    mutationFn: run,
    onSuccess: refresh,
    onError: (error) => {
      const code = error instanceof AdminCoursesApiError ? error.code : null
      if (code === 'forbidden') return queryClient.invalidateQueries({ queryKey: CURRENT_ACCESS_QUERY_KEY })
      if (code !== null && REFRESH_CODES.includes(code)) return refresh()
      return undefined
    },
  })
  useUnauthorizedSignOut(mutation.error)
  return mutation
}
