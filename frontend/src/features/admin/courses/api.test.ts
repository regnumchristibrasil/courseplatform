import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AdminCoursesApiError, getStaffCourse, listStaffCourses, mapCourseRow, mapCourseTree, parseErrorCode } from './api'

const ROW = {
  id: 'c1',
  title: 'Curso A',
  status: 'published',
  price_cents: 19900,
  access_duration_days: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  enrollment_count: 3,
  pending_order_count: 1,
}

function rpcClient(response: { data: unknown; error: unknown; status?: number }) {
  const rpc = vi.fn().mockResolvedValue(response)
  const schema = vi.fn().mockReturnValue({ rpc })
  return { client: { schema } as unknown as SupabaseClient, schema, rpc }
}

describe('parseErrorCode', () => {
  it('matches forbidden exactly in message or hint', () => {
    expect(parseErrorCode({ message: 'forbidden' })).toBe('forbidden')
    expect(parseErrorCode({ message: 'x', hint: 'forbidden' })).toBe('forbidden')
  })

  it('matches not_found exactly in message or hint', () => {
    expect(parseErrorCode({ message: 'not_found' })).toBe('not_found')
    expect(parseErrorCode({ message: 'x', hint: 'not_found' })).toBe('not_found')
    expect(parseErrorCode({ message: 'raise: not_found' })).toBe('internal')
  })

  it('does not match forbidden as a substring', () => {
    expect(parseErrorCode({ message: 'raise: forbidden' })).toBe('internal')
  })

  it('maps a bare 42501 to forbidden and a 401 to unauthorized', () => {
    expect(parseErrorCode({ code: '42501', message: 'insufficient privilege' }, 403)).toBe('forbidden')
    expect(parseErrorCode({ code: '42501', message: 'permission denied for schema app' }, 401)).toBe('unauthorized')
  })

  it('falls back to internal', () => {
    expect(parseErrorCode({ message: 'boom' })).toBe('internal')
    expect(parseErrorCode(null)).toBe('internal')
  })
})

describe('mapCourseRow', () => {
  it('maps snake_case to the contract shape', () => {
    expect(mapCourseRow(ROW)).toEqual({
      courseId: 'c1',
      title: 'Curso A',
      status: 'published',
      priceCents: 19900,
      accessDurationDays: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      enrollmentCount: 3,
      pendingOrderCount: 1,
    })
  })

  it('converts bigint counts delivered as strings', () => {
    expect(mapCourseRow({ ...ROW, enrollment_count: '7', pending_order_count: '0' })).toMatchObject({
      enrollmentCount: 7,
      pendingOrderCount: 0,
    })
  })

  it.each([
    null,
    'x',
    { ...ROW, id: '' },
    { ...ROW, status: 'deleted' },
    { ...ROW, price_cents: '10' },
    { ...ROW, access_duration_days: 'x' },
    { ...ROW, enrollment_count: -1 },
    { ...ROW, pending_order_count: 'abc' },
  ])('rejects malformed payload %#', (raw) => {
    expect(() => mapCourseRow(raw)).toThrow('Invalid admin courses payload.')
  })
})

describe('listStaffCourses', () => {
  it('calls app.staff_list_courses and maps rows', async () => {
    const { client, schema, rpc } = rpcClient({ data: [ROW], error: null })
    const result = await listStaffCourses(client)
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('staff_list_courses')
    expect(result).toHaveLength(1)
    expect(result[0]?.courseId).toBe('c1')
  })

  it('returns an empty list', async () => {
    const { client } = rpcClient({ data: [], error: null })
    expect(await listStaffCourses(client)).toEqual([])
  })

  it('rejects a non-array payload', async () => {
    const { client } = rpcClient({ data: {}, error: null })
    await expect(listStaffCourses(client)).rejects.toThrow('Invalid admin courses payload.')
  })

  it('throws a typed forbidden error', async () => {
    const { client } = rpcClient({
      data: null,
      error: { code: '42501', message: 'forbidden', hint: 'forbidden' },
      status: 403,
    })
    await expect(listStaffCourses(client)).rejects.toMatchObject({
      name: 'AdminCoursesApiError',
      code: 'forbidden',
    })
  })

  it('maps a 401 to unauthorized with the session-expired message', async () => {
    const { client } = rpcClient({ data: null, error: { code: '42501', message: 'x' }, status: 401 })
    const error = await listStaffCourses(client).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AdminCoursesApiError)
    expect(error).toMatchObject({ code: 'unauthorized', message: 'Sua sessão expirou. Entre novamente.' })
  })
})

const TREE_ROW = {
  ...ROW,
  description: 'Descricao',
  modules: [
    {
      id: 'm1',
      title: 'Modulo 1',
      position: 1,
      archived_at: null,
      lessons: [
        {
          id: 'l1',
          title: 'Aula 1',
          position: 1,
          duration_seconds: 600,
          is_free_preview: true,
          archived_at: null,
          video: { provider: 'youtube', external_ref: 'dQw4w9WgXcQ' },
        },
        {
          id: 'l2',
          title: 'Aula 2',
          position: 2,
          duration_seconds: null,
          is_free_preview: false,
          archived_at: '2026-02-01T00:00:00Z',
          video: null,
        },
      ],
    },
    { id: 'm2', title: 'Modulo 2', position: 2, archived_at: '2026-02-01T00:00:00Z', lessons: [] },
  ],
}

describe('mapCourseTree', () => {
  it('maps the nested payload to the contract shape', () => {
    const tree = mapCourseTree(TREE_ROW)
    expect(tree).toMatchObject({ courseId: 'c1', title: 'Curso A', description: 'Descricao', enrollmentCount: 3 })
    expect(tree.modules).toHaveLength(2)
    expect(tree.modules[0]).toMatchObject({ moduleId: 'm1', title: 'Modulo 1', position: 1, archivedAt: null })
    expect(tree.modules[0]?.lessons[0]).toEqual({
      lessonId: 'l1',
      title: 'Aula 1',
      position: 1,
      durationSeconds: 600,
      isFreePreview: true,
      archivedAt: null,
      video: { provider: 'youtube', externalRef: 'dQw4w9WgXcQ' },
    })
    expect(tree.modules[0]?.lessons[1]).toMatchObject({ archivedAt: '2026-02-01T00:00:00Z', video: null, durationSeconds: null })
    expect(tree.modules[1]).toMatchObject({ archivedAt: '2026-02-01T00:00:00Z', lessons: [] })
  })

  it('accepts a null description and no modules', () => {
    expect(mapCourseTree({ ...TREE_ROW, description: null, modules: [] })).toMatchObject({ description: null, modules: [] })
  })

  const lesson = TREE_ROW.modules[0]!.lessons[0]!
  const withLesson = (patch: Record<string, unknown>) => ({
    ...TREE_ROW,
    modules: [{ ...TREE_ROW.modules[0]!, lessons: [{ ...lesson, ...patch }] }],
  })

  it.each([
    null,
    { ...TREE_ROW, modules: 'x' },
    { ...TREE_ROW, description: 5 },
    { ...TREE_ROW, modules: [null] },
    { ...TREE_ROW, modules: [{ ...TREE_ROW.modules[0]!, id: '' }] },
    { ...TREE_ROW, modules: [{ ...TREE_ROW.modules[0]!, lessons: 'x' }] },
    { ...TREE_ROW, modules: [{ ...TREE_ROW.modules[0]!, archived_at: 7 }] },
    withLesson({ id: '' }),
    withLesson({ position: 'x' }),
    withLesson({ is_free_preview: 'yes' }),
    withLesson({ duration_seconds: 'x' }),
    withLesson({ archived_at: 7 }),
    withLesson({ video: { provider: 'vimeo', external_ref: 'x' } }),
    withLesson({ video: { provider: 'panda', external_ref: '' } }),
    withLesson({ video: 'x' }),
  ])('rejects malformed tree payload %#', (raw) => {
    expect(() => mapCourseTree(raw)).toThrow('Invalid admin courses payload.')
  })
})

describe('getStaffCourse', () => {
  it('calls app.staff_get_course with the course id and maps the tree', async () => {
    const { client, schema, rpc } = rpcClient({ data: TREE_ROW, error: null })
    const result = await getStaffCourse(client, 'c1')
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('staff_get_course', { p_course_id: 'c1' })
    expect(result.courseId).toBe('c1')
    expect(result.modules).toHaveLength(2)
  })

  it('rejects an array payload', async () => {
    const { client } = rpcClient({ data: [], error: null })
    await expect(getStaffCourse(client, 'c1')).rejects.toThrow('Invalid admin courses payload.')
  })

  it.each([
    ['forbidden', { code: '42501', message: 'forbidden', hint: 'forbidden' }, 403],
    ['not_found', { code: 'P0002', message: 'not_found', hint: 'not_found' }, 404],
  ] as const)('throws a typed %s error', async (code, error, status) => {
    const { client } = rpcClient({ data: null, error, status })
    await expect(getStaffCourse(client, 'c1')).rejects.toMatchObject({ name: 'AdminCoursesApiError', code })
  })

  it('maps a 401 to unauthorized', async () => {
    const { client } = rpcClient({ data: null, error: { code: '42501', message: 'x' }, status: 401 })
    await expect(getStaffCourse(client, 'c1')).rejects.toMatchObject({ code: 'unauthorized' })
  })
})
