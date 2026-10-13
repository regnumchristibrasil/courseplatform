import type { SupabaseClient } from '@supabase/supabase-js'
import { AdminUsersApiError, parseErrorCode } from '../admin/users/api'

const APP_SCHEMA = 'app'
const START_LESSON_RPC = 'start_lesson'

// true = progresso registrado (ou já existente); false = sem efeito (equipe,
// sem direito, aula arquivada). O servidor nunca devolve erro por falta de direito.
export async function startLesson(client: SupabaseClient, lessonId: string): Promise<boolean> {
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(START_LESSON_RPC, { p_lesson_id: lessonId })

  if (error) {
    if (parseErrorCode(error, status) === 'unauthorized') {
      throw new AdminUsersApiError('unauthorized', 'Sua sessão expirou. Entre novamente.')
    }
    throw new Error(`Failed to start lesson: ${error.message}`)
  }

  return Array.isArray(data) && data.length > 0
}
