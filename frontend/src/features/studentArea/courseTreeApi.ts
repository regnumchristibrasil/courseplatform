import type { SupabaseClient } from '@supabase/supabase-js'
import {
  COURSE_STATUSES,
  LESSON_STATES,
  type CourseTree,
  type CourseTreeLesson,
  type CourseTreeModule,
} from '../../contracts/studentArea'
import { AdminUsersApiError, parseErrorCode } from '../admin/users/api'

const APP_SCHEMA = 'app'
const COURSE_TREE_RPC = 'my_course_tree'
const INVALID_PAYLOAD = 'Invalid course tree payload.'

type Raw = Record<string, unknown>

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function invalid(): Error {
  return new Error(INVALID_PAYLOAD)
}

function parseLesson(raw: unknown): CourseTreeLesson {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'string' ||
    typeof raw.title !== 'string' ||
    !(raw.duration_seconds === null || typeof raw.duration_seconds === 'number') ||
    !isOneOf(LESSON_STATES, raw.state)
  ) {
    throw invalid()
  }
  return { id: raw.id, title: raw.title, durationSeconds: raw.duration_seconds, state: raw.state }
}

function parseModule(raw: unknown): CourseTreeModule {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string' || !Array.isArray(raw.lessons)) {
    throw invalid()
  }
  return { id: raw.id, title: raw.title, lessons: raw.lessons.map(parseLesson) }
}

function parseRow(row: unknown): CourseTree {
  if (
    !isRecord(row) ||
    typeof row.course_id !== 'string' ||
    typeof row.title !== 'string' ||
    !(row.description === null || typeof row.description === 'string') ||
    !isOneOf(COURSE_STATUSES, row.course_status) ||
    typeof row.is_staff !== 'boolean' ||
    typeof row.total_lessons !== 'number' ||
    typeof row.completed_lessons !== 'number' ||
    typeof row.progress_percent !== 'number' ||
    typeof row.total_duration_seconds !== 'number' ||
    !(row.continue_lesson_id === null || typeof row.continue_lesson_id === 'string') ||
    !Array.isArray(row.modules)
  ) {
    throw invalid()
  }
  return {
    courseId: row.course_id,
    title: row.title,
    description: row.description,
    courseStatus: row.course_status,
    isStaff: row.is_staff,
    totalLessons: row.total_lessons,
    completedLessons: row.completed_lessons,
    progressPercent: row.progress_percent,
    totalDurationSeconds: row.total_duration_seconds,
    continueLessonId: row.continue_lesson_id,
    modules: row.modules.map(parseModule),
  }
}

// Zero linhas (sem direito, curso inexistente) vira null: a tela mostra
// "página não encontrada" sem distinguir os motivos (ADR 0004).
export async function fetchCourseTree(client: SupabaseClient, courseId: string): Promise<CourseTree | null> {
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(COURSE_TREE_RPC, { p_course_id: courseId })

  if (error) {
    if (parseErrorCode(error, status) === 'unauthorized') {
      throw new AdminUsersApiError('unauthorized', 'Sua sessão expirou. Entre novamente.')
    }
    throw new Error(`Failed to load course: ${error.message}`)
  }

  const rows = (data as unknown[] | null) ?? []
  return rows.length === 0 ? null : parseRow(rows[0])
}
