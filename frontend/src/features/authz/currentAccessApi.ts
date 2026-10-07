import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrentAccess } from '../../contracts/adminUsers'
import { AdminUsersApiError, parseErrorCode } from '../admin/users/api'
import { isRole } from './roles'

const APP_SCHEMA = 'app'
const CURRENT_ACCESS_RPC = 'current_access'

function parseRow(row: unknown): CurrentAccess {
  const candidate = row as { role?: unknown; is_active?: unknown } | null
  if (!candidate || !isRole(candidate.role) || typeof candidate.is_active !== 'boolean') {
    throw new Error('Invalid current access payload.')
  }
  return { role: candidate.role, isActive: candidate.is_active }
}

// Retorna null apenas quando o RPC responde sem linha. Chamador anônimo NÃO
// retorna null: o PostgREST responde 401 "permission denied for schema app" e
// esta função lança AdminUsersApiError('unauthorized'). Isso é aceitável porque a query só é habilitada quando
// existe usuário (ver useCurrentAccess).
export async function fetchCurrentAccess(client: SupabaseClient): Promise<CurrentAccess | null> {
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(CURRENT_ACCESS_RPC)

  if (error) {
    // HTTP 401 vira erro tipado 'unauthorized' (reaproveita o código local da
    // área admin); 403 autenticado continua erro genérico e NÃO encerra a sessão.
    if (parseErrorCode(error, status) === 'unauthorized') {
      throw new AdminUsersApiError('unauthorized', 'Sua sessão expirou. Entre novamente.')
    }
    throw new Error(`Failed to load current access: ${error.message}`)
  }

  const row: unknown = Array.isArray(data) ? data[0] : data
  return row == null ? null : parseRow(row)
}
