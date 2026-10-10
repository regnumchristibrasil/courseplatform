import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { CURRENT_ACCESS_QUERY_KEY } from '../../authz/queryKeys'
import { addModule, AdminCoursesApiError, deleteModule, renameModule, reorderModules, setModuleArchived } from './api'
import { ADMIN_COURSES_QUERY_KEY } from './queryKeys'
import { useUnauthorizedSignOut } from './useUnauthorizedSignOut'

export type ModuleOperation =
  | { readonly kind: 'add'; readonly courseId: string; readonly title: string }
  | { readonly kind: 'rename'; readonly moduleId: string; readonly title: string }
  | { readonly kind: 'reorder'; readonly courseId: string; readonly moduleIds: readonly string[] }
  | { readonly kind: 'archive'; readonly moduleId: string; readonly archived: boolean }
  | { readonly kind: 'delete'; readonly moduleId: string }

const REFRESH_CODES: readonly string[] = ['stale_target', 'not_found', 'module_not_empty', 'course_has_sales']

function run(operation: ModuleOperation): Promise<void> {
  switch (operation.kind) {
    case 'add':
      return addModule(supabase, operation.courseId, operation.title)
    case 'rename':
      return renameModule(supabase, operation.moduleId, operation.title)
    case 'reorder':
      return reorderModules(supabase, operation.courseId, operation.moduleIds)
    case 'archive':
      return setModuleArchived(supabase, operation.moduleId, operation.archived)
    case 'delete':
      return deleteModule(supabase, operation.moduleId)
  }
}

// Pessimista, como useSaveCourse: sucesso e qualquer erro de estado (conflito,
// módulo sumido, regra de vendas/aulas) releem a árvore; perda de acesso
// revalida o papel.
export function useModuleAction(): UseMutationResult<void, Error, ModuleOperation> {
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
