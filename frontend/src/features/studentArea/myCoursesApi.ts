import type { SupabaseClient } from '@supabase/supabase-js'
import { COURSE_STATUSES, type MyCourse } from '../../contracts/studentArea'
import { AdminUsersApiError, parseErrorCode } from '../admin/users/api'

const APP_SCHEMA = 'app'
const MY_COURSES_RPC = 'my_courses'

function isCourseStatus(value: unknown): value is MyCourse['courseStatus'] {
  return typeof value === 'string' && (COURSE_STATUSES as readonly string[]).includes(value)
}

function parseRow(row: unknown): MyCourse {
  const r = row as Record<string, unknown> | null
  if (
    !r ||
    typeof r.course_id !== 'string' ||
    typeof r.title !== 'string' ||
    !isCourseStatus(r.course_status) ||
    typeof r.is_expired !== 'boolean' ||
    !(r.expires_at === null || typeof r.expires_at === 'string') ||
    typeof r.total_lessons !== 'number' ||
    typeof r.completed_lessons !== 'number' ||
    typeof r.progress_percent !== 'number'
  ) {
    throw new Error('Invalid my courses payload.')
  }
  return {
    courseId: r.course_id,
    title: r.title,
    courseStatus: r.course_status,
    isExpired: r.is_expired,
    expiresAt: r.expires_at,
    totalLessons: r.total_lessons,
    completedLessons: r.completed_lessons,
    progressPercent: r.progress_percent,
  }
}

// O servidor retorna zero linhas (nunca erro) para quem não tem direito.
export async function fetchMyCourses(client: SupabaseClient): Promise<readonly MyCourse[]> {
  const { data, error, status } = await client.schema(APP_SCHEMA).rpc(MY_COURSES_RPC)

  if (error) {
    if (parseErrorCode(error, status) === 'unauthorized') {
      throw new AdminUsersApiError('unauthorized', 'Sua sessão expirou. Entre novamente.')
    }
    throw new Error(`Failed to load my courses: ${error.message}`)
  }

  return ((data as unknown[] | null) ?? []).map(parseRow)
}
