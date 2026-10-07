import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ADMIN_USERS_ERROR_STATUS,
  MAX_LIST_LIMIT,
  MAX_REASON_LENGTH,
  type AdminUserRow,
  type ListUsersRequest,
  type ListUsersResponse,
  type SetActiveRequest,
  type SetActiveResponse,
  type SetRoleRequest,
  type SetRoleResponse,
} from '../../../contracts/adminUsers'
import { isRole } from '../../authz/roles'
import type { AdminUsersUiErrorCode } from './errors'
import { MAX_PAGE, MAX_SEARCH_LENGTH, MIN_SEARCH_LENGTH } from './limits'

const APP_SCHEMA = 'app'
const LIST_RPC = 'admin_list_users'
const SET_ROLE_RPC = 'admin_set_user_role'
const ADMIN_USERS_FUNCTION = 'admin-users'
const INVALID_PAYLOAD = 'Invalid admin users payload.'
const KNOWN_CODES = Object.keys(ADMIN_USERS_ERROR_STATUS) as readonly AdminUsersUiErrorCode[]
const HTTP_UNAUTHORIZED = 401
const PG_INSUFFICIENT_PRIVILEGE = '42501'
const SESSION_EXPIRED_MESSAGE = 'Sua sessão expirou. Entre novamente.'

export interface RpcErrorShape {
  readonly message?: string
  readonly hint?: string | null
  readonly code?: string
}

export class AdminUsersApiError extends Error {
  readonly code: AdminUsersUiErrorCode
  readonly requestId?: string

  constructor(code: AdminUsersUiErrorCode, message: string, requestId?: string) {
    super(message)
    this.name = 'AdminUsersApiError'
    this.code = code
    this.requestId = requestId
  }
}

export interface SetRoleInput extends SetRoleRequest {
  readonly reason?: string
}

function isKnownCode(value: unknown): value is AdminUsersUiErrorCode {
  return typeof value === 'string' && (KNOWN_CODES as readonly string[]).includes(value)
}

function exactCode(value: unknown): AdminUsersUiErrorCode | null {
  return isKnownCode(value) ? value : null
}

// Erros de RPC carregam o código em hint ou message (igualdade exata, nunca
// substring). 401 vem do gateway/PostgREST para sessão inválida. O 42501
// sem hint é mapeado para forbidden.
export function parseErrorCode(error: RpcErrorShape | null | undefined, status?: number): AdminUsersUiErrorCode {
  if (status === HTTP_UNAUTHORIZED) return 'unauthorized'
  const exact = exactCode(error?.hint) ?? exactCode(error?.message)
  if (exact) return exact
  return error?.code === PG_INSUFFICIENT_PRIVILEGE ? 'forbidden' : 'internal'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function invalidPayload(): Error {
  return new Error(INVALID_PAYLOAD)
}

function invalidInput(message: string): AdminUsersApiError {
  return new AdminUsersApiError('invalid_input', message)
}

// Caracteres de controle bidi (RLM/LRM/ALM, embeddings, overrides, isolates)
// em nome/e-mail permitiriam inverter a exibição visual (spoofing).
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

function stripBidi(value: string): string {
  return value.replace(BIDI_CONTROLS, '')
}

// Único ponto de mapeamento snake_case -> contrato (ajustar aqui se o RPC mudar).
export function mapUserRow(raw: unknown): AdminUserRow {
  if (!isRecord(raw)) throw invalidPayload()
  const { id, email, full_name, role, is_active, created_at } = raw
  const nameOk = full_name === null || typeof full_name === 'string'
  if (typeof id !== 'string' || id === '' || typeof email !== 'string' || !nameOk ||
      !isRole(role) || typeof is_active !== 'boolean' || typeof created_at !== 'string') {
    throw invalidPayload()
  }
  return {
    userId: id,
    email: stripBidi(email),
    fullName: typeof full_name === 'string' ? stripBidi(full_name) : null,
    role,
    isActive: is_active,
    createdAt: created_at,
  }
}

function mapListPayload(data: unknown): ListUsersResponse {
  if (!Array.isArray(data)) throw invalidPayload()
  if (data.length === 0) return { users: [], total: 0 }
  const first: unknown = data[0]
  const total = isRecord(first) ? first.total_count : undefined
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) throw invalidPayload()
  return { users: data.map(mapUserRow), total }
}

function validateListRequest(req: ListUsersRequest): void {
  if (!Number.isInteger(req.limit) || req.limit < 1 || req.limit > MAX_LIST_LIMIT) {
    throw invalidInput('limit out of range.')
  }
  const maxOffset = (MAX_PAGE - 1) * req.limit
  if (!Number.isInteger(req.offset) || req.offset < 0 || req.offset > maxOffset) {
    throw invalidInput('offset out of range.')
  }
  const search = req.search
  if (search !== undefined && (search.length < MIN_SEARCH_LENGTH || search.length > MAX_SEARCH_LENGTH)) {
    throw invalidInput('search length out of range.')
  }
}

function validateReason(reason: string | undefined): void {
  if (reason !== undefined && reason.length > MAX_REASON_LENGTH) throw invalidInput('reason too long.')
}

function validateUserId(userId: string): void {
  if (typeof userId !== 'string' || userId === '') throw invalidInput('userId required.')
}

function sessionExpired(): AdminUsersApiError {
  return new AdminUsersApiError('unauthorized', SESSION_EXPIRED_MESSAGE)
}

function rpcError(error: RpcErrorShape, status?: number): AdminUsersApiError {
  const code = parseErrorCode(error, status)
  if (code === 'unauthorized') return sessionExpired()
  return new AdminUsersApiError(code, error.message ?? 'Admin users request failed.')
}

export async function listAdminUsers(client: SupabaseClient, req: ListUsersRequest): Promise<ListUsersResponse> {
  validateListRequest(req)
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(LIST_RPC, {
    p_search: req.search ?? null,
    p_role: req.role ?? null,
    p_active: req.active ?? null,
    p_limit: req.limit,
    p_offset: req.offset,
  })
  if (error) throw rpcError(error, status)
  return mapListPayload(data)
}

function mapRolePayload(data: unknown): SetRoleResponse {
  const row: unknown = Array.isArray(data) ? data[0] : data
  if (!isRecord(row) || typeof row.user_id !== 'string' || !isRole(row.role)) throw invalidPayload()
  return { userId: row.user_id, role: row.role }
}

export async function setUserRole(client: SupabaseClient, req: SetRoleInput): Promise<SetRoleResponse> {
  validateUserId(req.userId)
  if (!isRole(req.role) || !isRole(req.expectedRole)) throw invalidInput('invalid role.')
  validateReason(req.reason)
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(SET_ROLE_RPC, {
    p_target: req.userId,
    p_role: req.role,
    p_expected_role: req.expectedRole,
    p_reason: req.reason ?? null,
  })
  if (error) throw rpcError(error, status)
  return mapRolePayload(data)
}

// Envelope do Edge Function: {error:{code,message,requestId}} no corpo HTTP.
// Rejeição do gateway da plataforma (ex.: JWT inválido) vem com HTTP 401 e
// sem .error; vira o código local 'unauthorized' (fora do contrato).
async function readEnvelope(error: { message?: string; context?: unknown }): Promise<AdminUsersApiError> {
  const fallback = new AdminUsersApiError('internal', error.message ?? 'Admin users request failed.')
  if (!(error.context instanceof Response)) return fallback
  if (error.context.status === HTTP_UNAUTHORIZED) return sessionExpired()
  try {
    const body: unknown = await error.context.json()
    const env = isRecord(body) && isRecord(body.error) ? body.error : null
    if (!env) return fallback
    const code = isKnownCode(env.code) ? env.code : 'internal'
    const message = typeof env.message === 'string' ? env.message : fallback.message
    const requestId = typeof env.requestId === 'string' ? env.requestId : undefined
    return new AdminUsersApiError(code, message, requestId)
  } catch {
    return fallback
  }
}

function mapActivePayload(data: unknown): SetActiveResponse {
  if (!isRecord(data) || typeof data.userId !== 'string' || typeof data.isActive !== 'boolean') {
    throw invalidPayload()
  }
  return { userId: data.userId, isActive: data.isActive }
}

export async function setUserActive(client: SupabaseClient, req: SetActiveRequest): Promise<SetActiveResponse> {
  validateUserId(req.userId)
  validateReason(req.reason)
  const { data, error } = await client.functions.invoke(ADMIN_USERS_FUNCTION, {
    body: {
      action: 'set_active',
      userId: req.userId,
      active: req.active,
      expectedActive: req.expectedActive,
      ...(req.reason !== undefined ? { reason: req.reason } : {}),
    },
  })
  if (error) throw await readEnvelope(error)
  return mapActivePayload(data)
}
