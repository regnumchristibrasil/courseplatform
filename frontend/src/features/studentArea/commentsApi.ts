import type { SupabaseClient } from '@supabase/supabase-js'
import {
  COMMENT_PAGE_SIZE,
  STUDENT_AREA_ERROR_CODES,
  type CommentCursor,
  type LessonComment,
  type StudentAreaErrorCode,
} from '../../contracts/studentArea'

const APP_SCHEMA = 'app'
const LIST_RPC = 'list_lesson_comments'
const CREATE_RPC = 'create_lesson_comment'
const INVALID_PAYLOAD = 'Invalid lesson comments payload.'
const HTTP_UNAUTHORIZED = 401
const PG_INSUFFICIENT_PRIVILEGE = '42501'

interface RpcErrorShape {
  readonly message?: string
  readonly hint?: string | null
  readonly code?: string
}

export class StudentAreaApiError extends Error {
  readonly code: StudentAreaErrorCode

  constructor(code: StudentAreaErrorCode, message: string) {
    super(message)
    this.name = 'StudentAreaApiError'
    this.code = code
  }
}

export interface CommentsPage {
  readonly comments: readonly LessonComment[]
  readonly nextCursor: CommentCursor | null
}

function exactCode(value: unknown): StudentAreaErrorCode | null {
  return typeof value === 'string' && (STUDENT_AREA_ERROR_CODES as readonly string[]).includes(value)
    ? (value as StudentAreaErrorCode)
    : null
}

// O código vem em hint ou message (igualdade exata, nunca substring). 401 é do
// gateway para sessão inválida; 42501 sem hint conhecido vira forbidden.
function parseErrorCode(error: RpcErrorShape, status?: number): StudentAreaErrorCode | null {
  if (status === HTTP_UNAUTHORIZED) return 'unauthorized'
  return exactCode(error.hint) ?? exactCode(error.message) ?? (error.code === PG_INSUFFICIENT_PRIVILEGE ? 'forbidden' : null)
}

function toApiError(error: RpcErrorShape, status: number | undefined, fallback: string): Error {
  const code = parseErrorCode(error, status)
  return code ? new StudentAreaApiError(code, code) : new Error(`${fallback}: ${error.message ?? 'unknown'}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseComment(raw: unknown): LessonComment {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'string' ||
    typeof raw.author_first_name !== 'string' ||
    typeof raw.is_staff_author !== 'boolean' ||
    typeof raw.body !== 'string' ||
    typeof raw.created_at !== 'string' ||
    typeof raw.is_own !== 'boolean'
  ) {
    throw new Error(INVALID_PAYLOAD)
  }
  return {
    id: raw.id,
    authorFirstName: raw.author_first_name,
    isStaffAuthor: raw.is_staff_author,
    body: raw.body,
    createdAt: raw.created_at,
    isOwn: raw.is_own,
  }
}

// Zero linhas = lista vazia (sem comentários ou sem direito; a tela da aula já
// foi barrada antes). O servidor devolve até PAGE_SIZE + 1: a linha extra só
// indica que há mais e nunca é exibida.
export async function listLessonComments(
  client: SupabaseClient,
  lessonId: string,
  cursor: CommentCursor | null,
): Promise<CommentsPage> {
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(LIST_RPC, {
    p_lesson_id: lessonId,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  })

  if (error) {
    throw toApiError(error, status, 'Failed to load lesson comments')
  }

  const rows = ((data as unknown[] | null) ?? []).map(parseComment)
  const comments = rows.slice(0, COMMENT_PAGE_SIZE)
  const last = comments[comments.length - 1]
  const hasMore = rows.length > COMMENT_PAGE_SIZE && last !== undefined
  return { comments, nextCursor: hasMore ? { createdAt: last.createdAt, id: last.id } : null }
}

export async function createLessonComment(client: SupabaseClient, lessonId: string, body: string): Promise<LessonComment> {
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(CREATE_RPC, { p_lesson_id: lessonId, p_body: body })

  if (error) {
    throw toApiError(error, status, 'Failed to create lesson comment')
  }

  const rows = (data as unknown[] | null) ?? []
  if (rows.length === 0) throw new Error(INVALID_PAYLOAD)
  return parseComment(rows[0])
}
