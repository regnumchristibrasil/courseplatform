import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ResolvedVideo } from '../../contracts/video'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../auth/useAuth'
import { fetchLessonVideo } from './lessonVideoApi'
import { lessonVideoKey } from './queryKeys'

// Referências expiram (Panda): sem cache entre visitas.
export function useLessonVideo(lessonId: string): UseQueryResult<ResolvedVideo | null, Error> {
  const { user } = useAuth()
  return useQuery({
    queryKey: lessonVideoKey(user?.id ?? '', lessonId),
    queryFn: () => fetchLessonVideo(supabase, lessonId),
    enabled: user !== null && lessonId !== '',
    gcTime: 0,
  })
}
