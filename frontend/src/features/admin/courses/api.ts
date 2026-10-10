import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ADMIN_COURSES_ERROR_STATUS,
  type AdminCoursesErrorCode,
  type AdminCoursesRequest,
  type CourseListRow,
  type CourseStatus,
  type CourseTree,
  type LessonNode,
  type LessonVideo,
  type ModuleNode,
  type SaveCourseResponse,
  type VideoProvider,
} from '../../../contracts/adminCourses'

const APP_SCHEMA = 'app'
const LIST_RPC = 'staff_list_courses'
const GET_RPC = 'staff_get_course'
const ADMIN_COURSES_FUNCTION = 'admin-courses'
const KNOWN_CODES = Object.keys(ADMIN_COURSES_ERROR_STATUS) as readonly AdminCoursesErrorCode[]
const INVALID_PAYLOAD = 'Invalid admin courses payload.'
const HTTP_UNAUTHORIZED = 401
const PG_INSUFFICIENT_PRIVILEGE = '42501'
export const SESSION_EXPIRED_MESSAGE = 'Sua sessão expirou. Entre novamente.'
const COURSE_STATUSES: readonly CourseStatus[] = ['draft', 'published', 'archived']
const VIDEO_PROVIDERS: readonly VideoProvider[] = ['youtube', 'panda']

// 'internal' é o código genérico local para erros desconhecidos/transporte.
// 'unauthorized' é local à UI (HTTP 401): sessão expirada; fora do contrato.
export type AdminCoursesUiErrorCode = AdminCoursesErrorCode | 'internal' | 'unauthorized'

export interface RpcErrorShape {
  readonly message?: string
  readonly hint?: string | null
  readonly code?: string
}

export class AdminCoursesApiError extends Error {
  readonly code: AdminCoursesUiErrorCode
  readonly requestId?: string

  constructor(code: AdminCoursesUiErrorCode, message: string, requestId?: string) {
    super(message)
    this.name = 'AdminCoursesApiError'
    this.code = code
    this.requestId = requestId
  }
}

function isKnownCode(value: unknown): value is AdminCoursesErrorCode {
  return typeof value === 'string' && (KNOWN_CODES as readonly string[]).includes(value)
}

// Erros de RPC carregam o código em hint ou message (igualdade exata, nunca
// substring). 401 vem do gateway/PostgREST para sessão inválida.
export function parseErrorCode(error: RpcErrorShape | null | undefined, status?: number): AdminCoursesUiErrorCode {
  if (status === HTTP_UNAUTHORIZED) return 'unauthorized'
  const exact = isKnownCode(error?.hint) ? error?.hint : isKnownCode(error?.message) ? error?.message : null
  if (exact) return exact
  return error?.code === PG_INSUFFICIENT_PRIVILEGE ? 'forbidden' : 'internal'
}

function toApiError(error: RpcErrorShape, status?: number): AdminCoursesApiError {
  const code = parseErrorCode(error, status)
  return new AdminCoursesApiError(code, code === 'unauthorized' ? SESSION_EXPIRED_MESSAGE : error.message ?? 'Admin courses request failed.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function invalidPayload(): Error {
  return new Error(INVALID_PAYLOAD)
}

function isCourseStatus(value: unknown): value is CourseStatus {
  return typeof value === 'string' && (COURSE_STATUSES as readonly string[]).includes(value)
}

// bigint do Postgres chega como número ou string numérica via PostgREST.
function toCount(value: unknown): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 0) throw invalidPayload()
  return parsed
}

// Único ponto de mapeamento snake_case -> contrato (ajustar aqui se o RPC mudar).
export function mapCourseRow(raw: unknown): CourseListRow {
  if (!isRecord(raw)) throw invalidPayload()
  const { id, title, status, price_cents, access_duration_days, created_at, updated_at } = raw
  const durationOk = access_duration_days === null || Number.isInteger(access_duration_days)
  if (typeof id !== 'string' || id === '' || typeof title !== 'string' || !isCourseStatus(status) ||
      !(price_cents === null || Number.isInteger(price_cents)) || !durationOk ||
      typeof created_at !== 'string' || typeof updated_at !== 'string') {
    throw invalidPayload()
  }
  return {
    courseId: id,
    title,
    status,
    priceCents: price_cents as number | null,
    accessDurationDays: access_duration_days as number | null,
    createdAt: created_at,
    updatedAt: updated_at,
    enrollmentCount: toCount(raw.enrollment_count),
    pendingOrderCount: toCount(raw.pending_order_count),
  }
}

export async function listStaffCourses(client: SupabaseClient): Promise<readonly CourseListRow[]> {
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(LIST_RPC)
  if (error) throw toApiError(error, status)
  if (!Array.isArray(data)) throw invalidPayload()
  return data.map(mapCourseRow)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function mapVideo(raw: unknown): LessonVideo | null {
  if (raw === null) return null
  if (!isRecord(raw)) throw invalidPayload()
  const { provider, external_ref } = raw
  if (typeof provider !== 'string' || !(VIDEO_PROVIDERS as readonly string[]).includes(provider) || !isNonEmptyString(external_ref)) {
    throw invalidPayload()
  }
  return { provider: provider as VideoProvider, externalRef: external_ref }
}

function mapLesson(raw: unknown): LessonNode {
  if (!isRecord(raw)) throw invalidPayload()
  const { id, title, position, duration_seconds, is_free_preview, archived_at, video } = raw
  if (!isNonEmptyString(id) || typeof title !== 'string' || !Number.isInteger(position) ||
      !(duration_seconds === null || Number.isInteger(duration_seconds)) ||
      typeof is_free_preview !== 'boolean' || !isNullableString(archived_at)) {
    throw invalidPayload()
  }
  return {
    lessonId: id,
    title,
    position: position as number,
    durationSeconds: duration_seconds as number | null,
    isFreePreview: is_free_preview,
    archivedAt: archived_at,
    video: mapVideo(video),
  }
}

function mapModule(raw: unknown): ModuleNode {
  if (!isRecord(raw)) throw invalidPayload()
  const { id, title, position, archived_at, lessons } = raw
  if (!isNonEmptyString(id) || typeof title !== 'string' || !Number.isInteger(position) ||
      !isNullableString(archived_at) || !Array.isArray(lessons)) {
    throw invalidPayload()
  }
  return { moduleId: id, title, position: position as number, archivedAt: archived_at, lessons: lessons.map(mapLesson) }
}

export function mapCourseTree(raw: unknown): CourseTree {
  if (!isRecord(raw)) throw invalidPayload()
  const { description, modules } = raw
  if (!isNullableString(description) || !Array.isArray(modules)) throw invalidPayload()
  return { ...mapCourseRow(raw), description, modules: modules.map(mapModule) }
}

export async function getStaffCourse(client: SupabaseClient, courseId: string): Promise<CourseTree> {
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(GET_RPC, { p_course_id: courseId })
  if (error) throw toApiError(error, status)
  return mapCourseTree(data)
}

function mapSaveResponse(data: unknown): SaveCourseResponse {
  if (!isRecord(data) || !isNonEmptyString(data.courseId) || !isNonEmptyString(data.updatedAt)) throw invalidPayload()
  return { courseId: data.courseId, updatedAt: data.updatedAt }
}

// Envelope da Edge Function: {error:{code,message,requestId}} no corpo HTTP.
// Rejeição do gateway (JWT inválido) vem com HTTP 401 e sem .error.
async function readEnvelope(error: { message?: string; context?: unknown }): Promise<AdminCoursesApiError> {
  const fallback = new AdminCoursesApiError('internal', error.message ?? 'Admin courses request failed.')
  if (!(error.context instanceof Response)) return fallback
  if (error.context.status === HTTP_UNAUTHORIZED) return new AdminCoursesApiError('unauthorized', SESSION_EXPIRED_MESSAGE)
  try {
    const body: unknown = await error.context.json()
    const env = isRecord(body) && isRecord(body.error) ? body.error : null
    if (!env) return fallback
    const code = isKnownCode(env.code) ? env.code : 'internal'
    const message = typeof env.message === 'string' ? env.message : fallback.message
    const requestId = typeof env.requestId === 'string' ? env.requestId : undefined
    return new AdminCoursesApiError(code, message, requestId)
  } catch {
    return fallback
  }
}

export async function saveCourse(client: SupabaseClient, request: AdminCoursesRequest): Promise<SaveCourseResponse> {
  const { data, error } = await client.functions.invoke(ADMIN_COURSES_FUNCTION, { body: request })
  if (error) throw await readEnvelope(error)
  return mapSaveResponse(data)
}

// Gestão de módulos: RPCs chamadas direto pelo PostgREST com o JWT do usuário
// (ADR 0002, decisão 3). O banco aplica papel, vendas e conflito de lista.
async function callModuleRpc(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<void> {
  const { error, status } = await client.schema(APP_SCHEMA).rpc(fn, args)
  if (error) throw toApiError(error, status)
}

export const addModule = (client: SupabaseClient, courseId: string, title: string) =>
  callModuleRpc(client, 'staff_add_module', { p_course_id: courseId, p_title: title })

export const renameModule = (client: SupabaseClient, moduleId: string, title: string) =>
  callModuleRpc(client, 'staff_rename_module', { p_module_id: moduleId, p_title: title })

// Lista completa e ordenada (arquivados inclusos); lista desatualizada -> stale_target.
export const reorderModules = (client: SupabaseClient, courseId: string, moduleIds: readonly string[]) =>
  callModuleRpc(client, 'staff_reorder_modules', { p_course_id: courseId, p_module_ids: moduleIds })

export const setModuleArchived = (client: SupabaseClient, moduleId: string, archived: boolean) =>
  callModuleRpc(client, 'staff_set_module_archived', { p_module_id: moduleId, p_archived: archived })

export const deleteModule = (client: SupabaseClient, moduleId: string) =>
  callModuleRpc(client, 'staff_delete_module', { p_module_id: moduleId })
