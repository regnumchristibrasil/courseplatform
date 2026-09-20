import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { fetchPublishedCourses } from './coursesApi'
import type { CoursePublic } from './types'

function buildFakeClient(response: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(response)
  const select = vi.fn().mockReturnValue({ order })
  const from = vi.fn().mockReturnValue({ select })

  const client = { from } as unknown as SupabaseClient
  return { client, from, select, order }
}

const SAMPLE_COURSES: readonly CoursePublic[] = [
  {
    id: 'course-1',
    title: 'Introdução ao React',
    description: 'Fundamentos de React na prática.',
    price_cents: 19900,
    access_duration_days: null,
  },
  {
    id: 'course-2',
    title: 'TypeScript avançado',
    description: 'Tipos avançados e padrões.',
    price_cents: 29900,
    access_duration_days: 365,
  },
]

describe('fetchPublishedCourses', () => {
  it('queries the courses_public view and returns the mapped rows', async () => {
    const { client, from, select } = buildFakeClient({ data: SAMPLE_COURSES, error: null })

    const result = await fetchPublishedCourses(client)

    expect(from).toHaveBeenCalledWith('courses_public')
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining('price_cents'),
    )
    expect(result).toEqual(SAMPLE_COURSES)
  })

  it('returns an empty array when there are no published courses (not an error)', async () => {
    const { client } = buildFakeClient({ data: [], error: null })

    const result = await fetchPublishedCourses(client)

    expect(result).toEqual([])
  })

  it('returns an empty array when data is null but there is no error', async () => {
    const { client } = buildFakeClient({ data: null, error: null })

    const result = await fetchPublishedCourses(client)

    expect(result).toEqual([])
  })

  it('throws a normalized error (never swallows) when PostgREST reports an error', async () => {
    const { client } = buildFakeClient({
      data: null,
      error: { message: 'relation "courses_public" does not exist' },
    })

    await expect(fetchPublishedCourses(client)).rejects.toThrow(
      /relation "courses_public" does not exist/,
    )
  })
})
