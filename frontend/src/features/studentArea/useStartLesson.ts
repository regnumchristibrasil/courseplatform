import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import { COURSE_TREE_QUERY_KEY, MY_COURSES_QUERY_KEY } from './queryKeys'
import { startLesson } from './startLessonApi'

// Idempotente no servidor. Só invalida quando algo foi registrado, para o
// ícone "em andamento" e o painel "Meus cursos" refletirem a abertura.
export function useStartLesson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (lessonId: string) => startLesson(supabase, lessonId),
    onSuccess: (registered) => {
      if (!registered) return
      void queryClient.invalidateQueries({ queryKey: COURSE_TREE_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: MY_COURSES_QUERY_KEY })
    },
  })
}
