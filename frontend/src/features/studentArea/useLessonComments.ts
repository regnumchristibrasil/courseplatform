import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CommentCursor } from '../../contracts/studentArea'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../auth/useAuth'
import { createLessonComment, deleteLessonComment, listLessonComments } from './commentsApi'
import { LESSON_COMMENTS_QUERY_KEY, lessonCommentsKey } from './queryKeys'

// A chave inclui o usuário: trocar de conta nunca reaproveita o cache anterior.
export function useLessonComments(lessonId: string) {
  const { user } = useAuth()
  return useInfiniteQuery({
    queryKey: lessonCommentsKey(user?.id ?? '', lessonId),
    queryFn: ({ pageParam }) => listLessonComments(supabase, lessonId, pageParam),
    initialPageParam: null as CommentCursor | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: user !== null && lessonId !== '',
  })
}

// Sem tempo real: após publicar, a lista é recarregada do servidor (a ordem e o
// cursor continuam sendo decididos lá).
export function usePublishLessonComment(lessonId: string, parentId: string | null = null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => createLessonComment(supabase, lessonId, body, parentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LESSON_COMMENTS_QUERY_KEY }),
  })
}

// A exclusão é lógica e decidida no servidor: recarregar a lista mostra o
// estado real ("comentário removido" ou desaparecimento).
export function useDeleteLessonComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => deleteLessonComment(supabase, commentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LESSON_COMMENTS_QUERY_KEY }),
  })
}
