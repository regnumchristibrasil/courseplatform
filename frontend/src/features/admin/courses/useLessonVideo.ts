import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { SetLessonVideoResult } from '../../../contracts/adminCourses'
import { supabase } from '../../../lib/supabaseClient'
import { CURRENT_ACCESS_QUERY_KEY } from '../../authz/queryKeys'
import { AdminCoursesApiError, setLessonVideo } from './api'
import { ADMIN_COURSES_QUERY_KEY } from './queryKeys'
import { useUnauthorizedSignOut } from './useUnauthorizedSignOut'

export interface LessonVideoRequest {
  readonly lessonId: string
  readonly expectedUpdatedAt: string // token do locking otimista, como lido
  readonly videoInput: string
}

const REFRESH_CODES: readonly string[] = ['stale_target', 'not_found']

// Pessimista, como useLessonAction: sucesso e erros de estado releem a árvore;
// perda de acesso revalida o papel. O texto digitado fica no formulário.
export function useLessonVideo(): UseMutationResult<SetLessonVideoResult, Error, LessonVideoRequest> {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ADMIN_COURSES_QUERY_KEY })
  const mutation = useMutation({
    mutationFn: (request: LessonVideoRequest) => setLessonVideo(supabase, request.lessonId, request.expectedUpdatedAt, request.videoInput),
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
