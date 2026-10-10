import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { LessonFieldsInput } from '../../../contracts/adminCourses'
import { supabase } from '../../../lib/supabaseClient'
import { CURRENT_ACCESS_QUERY_KEY } from '../../authz/queryKeys'
import { addLesson, AdminCoursesApiError, deleteLesson, moveLesson, reorderLessons, setLessonArchived, updateLesson } from './api'
import { ADMIN_COURSES_QUERY_KEY } from './queryKeys'
import { useUnauthorizedSignOut } from './useUnauthorizedSignOut'

// Operações sobre uma aula carregam o updated_at lido (token do locking otimista).
export type LessonOperation =
  | { readonly kind: 'add'; readonly moduleId: string; readonly fields: LessonFieldsInput; readonly archived: boolean }
  | { readonly kind: 'update'; readonly lessonId: string; readonly expectedUpdatedAt: string; readonly fields: LessonFieldsInput }
  | { readonly kind: 'reorder'; readonly moduleId: string; readonly lessonIds: readonly string[] }
  | { readonly kind: 'move'; readonly lessonId: string; readonly expectedUpdatedAt: string; readonly targetModuleId: string }
  | { readonly kind: 'archive'; readonly lessonId: string; readonly expectedUpdatedAt: string; readonly archived: boolean }
  | { readonly kind: 'delete'; readonly lessonId: string; readonly expectedUpdatedAt: string }

// publish_gate_violated não relê: nada mudou no servidor e o formulário aberto é mantido.
const REFRESH_CODES: readonly string[] = ['stale_target', 'not_found', 'course_has_sales']

function run(operation: LessonOperation): Promise<void> {
  switch (operation.kind) {
    case 'add':
      return addLesson(supabase, operation.moduleId, operation.fields, operation.archived)
    case 'update':
      return updateLesson(supabase, operation.lessonId, operation.expectedUpdatedAt, operation.fields)
    case 'reorder':
      return reorderLessons(supabase, operation.moduleId, operation.lessonIds)
    case 'move':
      return moveLesson(supabase, operation.lessonId, operation.expectedUpdatedAt, operation.targetModuleId)
    case 'archive':
      return setLessonArchived(supabase, operation.lessonId, operation.expectedUpdatedAt, operation.archived)
    case 'delete':
      return deleteLesson(supabase, operation.lessonId, operation.expectedUpdatedAt)
  }
}

// Pessimista, como useModuleAction: sucesso e erros de estado releem a árvore;
// perda de acesso revalida o papel.
export function useLessonAction(): UseMutationResult<void, Error, LessonOperation> {
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
