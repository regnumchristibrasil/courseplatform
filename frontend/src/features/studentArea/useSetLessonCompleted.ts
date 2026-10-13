import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { setLessonCompleted } from './completionApi'
import { COURSE_TREE_QUERY_KEY, MY_COURSES_QUERY_KEY } from './queryKeys'

export interface SetLessonCompletedInput {
  readonly lessonId: string
  readonly completed: boolean
}

// Resolve true quando o servidor aplicou a mudança. Em ambos os casos a árvore
// e "Meus cursos" são recarregados, para percentuais e ícones refletirem o servidor.
export function useSetLessonCompleted() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ lessonId, completed }: SetLessonCompletedInput) => setLessonCompleted(supabase, lessonId, completed),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: COURSE_TREE_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: MY_COURSES_QUERY_KEY })
    },
  })
}
