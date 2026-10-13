import type { SupabaseClient } from '@supabase/supabase-js'
import { AdminUsersApiError, parseErrorCode } from '../admin/users/api'

const APP_SCHEMA = 'app'
const COMPLETE_LESSON_RPC = 'complete_lesson'
const UNCOMPLETE_LESSON_RPC = 'uncomplete_lesson'

// true = alteração aplicada (ou já no estado pedido); false = sem efeito
// (equipe, sem direito, aula arquivada). O servidor nunca devolve erro por falta de direito.
export async function setLessonCompleted(client: SupabaseClient, lessonId: string, completed: boolean): Promise<boolean> {
  const rpcName = completed ? COMPLETE_LESSON_RPC : UNCOMPLETE_LESSON_RPC
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(rpcName, { p_lesson_id: lessonId })

  if (error) {
    if (parseErrorCode(error, status) === 'unauthorized') {
      throw new AdminUsersApiError('unauthorized', 'Sua sessão expirou. Entre novamente.')
    }
    throw new Error(`Failed to update lesson completion: ${error.message}`)
  }

  return Array.isArray(data) && data.length > 0
}
