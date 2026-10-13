import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AdminUsersApiError } from '../admin/users/api'
import { fetchCourseTree } from './courseTreeApi'

function buildFakeClient(response: { data: unknown; error: unknown; status?: number }) {
  const rpc = vi.fn().mockResolvedValue(response)
  const schema = vi.fn().mockReturnValue({ rpc })
  return { client: { schema } as unknown as SupabaseClient, schema, rpc }
}

const ROW = {
  course_id: 'course-1',
  title: 'Introducao',
  description: 'Sobre o curso',
  course_status: 'published',
  is_staff: false,
  total_lessons: 2,
  completed_lessons: 1,
  progress_percent: 50,
  total_duration_seconds: 90,
  continue_lesson_id: 'l2',
  modules: [
    {
      id: 'm1',
      title: 'Modulo 1',
      lessons: [
        { id: 'l1', title: 'Aula 1', duration_seconds: 60, state: 'completed' },
        { id: 'l2', title: 'Aula 2', duration_seconds: null, state: 'in_progress' },
      ],
    },
  ],
}

describe('fetchCourseTree', () => {
  it('calls app.my_course_tree with the course id and maps the row to the contract shape', async () => {
    const { client, schema, rpc } = buildFakeClient({ data: [ROW], error: null })

    await expect(fetchCourseTree(client, 'course-1')).resolves.toEqual({
      courseId: 'course-1',
      title: 'Introducao',
      description: 'Sobre o curso',
      courseStatus: 'published',
      isStaff: false,
      totalLessons: 2,
      completedLessons: 1,
      progressPercent: 50,
      totalDurationSeconds: 90,
      continueLessonId: 'l2',
      modules: [
        {
          id: 'm1',
          title: 'Modulo 1',
          lessons: [
            { id: 'l1', title: 'Aula 1', durationSeconds: 60, state: 'completed' },
            { id: 'l2', title: 'Aula 2', durationSeconds: null, state: 'in_progress' },
          ],
        },
      ],
    })
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('my_course_tree', { p_course_id: 'course-1' })
  })

  it('returns null when the server returns zero rows (no access)', async () => {
    const { client } = buildFakeClient({ data: [], error: null })
    await expect(fetchCourseTree(client, 'course-1')).resolves.toBeNull()
  })

  it('maps an unauthorized error to AdminUsersApiError', async () => {
    const { client } = buildFakeClient({ data: null, error: { message: 'JWT expired' }, status: 401 })
    await expect(fetchCourseTree(client, 'course-1')).rejects.toBeInstanceOf(AdminUsersApiError)
  })

  it('throws on other errors', async () => {
    const { client } = buildFakeClient({ data: null, error: { message: 'boom' }, status: 500 })
    await expect(fetchCourseTree(client, 'course-1')).rejects.toThrow(/failed to load course/i)
  })

  it('rejects a malformed payload', async () => {
    const { client } = buildFakeClient({
      data: [{ ...ROW, modules: [{ id: 'm1', title: 'x', lessons: [{ id: 'l', title: 't', duration_seconds: 1, state: 'bogus' }] }] }],
      error: null,
    })
    await expect(fetchCourseTree(client, 'course-1')).rejects.toThrow(/invalid course tree payload/i)
  })
})
