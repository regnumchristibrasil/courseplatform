import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AdminUsersApiError } from '../admin/users/api'
import { fetchMyCourses } from './myCoursesApi'

function buildFakeClient(response: { data: unknown; error: unknown; status?: number }) {
  const rpc = vi.fn().mockResolvedValue(response)
  const schema = vi.fn().mockReturnValue({ rpc })
  return { client: { schema } as unknown as SupabaseClient, schema, rpc }
}

const ROW = {
  course_id: 'course-1',
  title: 'Introducao',
  course_status: 'published',
  is_expired: false,
  expires_at: null,
  total_lessons: 4,
  completed_lessons: 2,
  progress_percent: 50,
}

describe('fetchMyCourses', () => {
  it('calls app.my_courses and maps rows to the contract shape', async () => {
    const { client, schema, rpc } = buildFakeClient({ data: [ROW], error: null })

    await expect(fetchMyCourses(client)).resolves.toEqual([
      {
        courseId: 'course-1',
        title: 'Introducao',
        courseStatus: 'published',
        isExpired: false,
        expiresAt: null,
        totalLessons: 4,
        completedLessons: 2,
        progressPercent: 50,
      },
    ])
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('my_courses')
  })

  it('returns an empty list for null or empty data', async () => {
    await expect(fetchMyCourses(buildFakeClient({ data: null, error: null }).client)).resolves.toEqual([])
    await expect(fetchMyCourses(buildFakeClient({ data: [], error: null }).client)).resolves.toEqual([])
  })

  it('rejects a malformed row', async () => {
    const { client } = buildFakeClient({ data: [{ ...ROW, progress_percent: 'x' }], error: null })
    await expect(fetchMyCourses(client)).rejects.toThrow('Invalid my courses payload.')
  })

  it('rejects an unknown course status', async () => {
    const { client } = buildFakeClient({ data: [{ ...ROW, course_status: 'weird' }], error: null })
    await expect(fetchMyCourses(client)).rejects.toThrow('Invalid my courses payload.')
  })

  it('maps HTTP 401 to a typed unauthorized error', async () => {
    const { client } = buildFakeClient({
      data: null,
      error: { code: '42501', message: 'permission denied for schema app', hint: null },
      status: 401,
    })
    const failure = await fetchMyCourses(client).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(AdminUsersApiError)
    expect(failure).toMatchObject({ code: 'unauthorized' })
  })

  it('throws a generic error for other failures', async () => {
    const { client } = buildFakeClient({
      data: null,
      error: { code: 'XX000', message: 'boom', hint: null },
      status: 500,
    })
    await expect(fetchMyCourses(client)).rejects.toThrow('Failed to load my courses: boom')
  })
})
