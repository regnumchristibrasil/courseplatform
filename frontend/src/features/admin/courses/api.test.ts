import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  addLesson,
  addModule,
  AdminCoursesApiError,
  deleteLesson,
  deleteModule,
  getStaffCourse,
  listStaffCourses,
  mapCourseRow,
  mapCourseTree,
  moveLesson,
  parseErrorCode,
  renameModule,
  reorderLessons,
  reorderModules,
  saveCourse,
  setLessonArchived,
  setLessonVideo,
  setModuleArchived,
  updateLesson,
} from './api'

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
          updated_at: '2026-01-03T10:00:00.123456+00:00',
          video: { provider: 'youtube', external_ref: 'dQw4w9WgXcQ' },
        },
        {
          id: 'l2',
          title: 'Aula 2',
          position: 2,
          duration_seconds: null,
          is_free_preview: false,
          archived_at: '2026-02-01T00:00:00Z',
          updated_at: '2026-01-04T10:00:00.5+00:00',
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
      updatedAt: '2026-01-03T10:00:00.123456+00:00',
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
    withLesson({ updated_at: undefined }),
    withLesson({ updated_at: 5 }),
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

describe('parseErrorCode (write codes)', () => {
  it('matches invalid_input and stale_target exactly', () => {
    expect(parseErrorCode({ message: 'stale_target' })).toBe('stale_target')
    expect(parseErrorCode({ message: 'x', hint: 'invalid_input' })).toBe('invalid_input')
    expect(parseErrorCode({ message: 'raise: stale_target' })).toBe('internal')
  })
})

describe('mapCourseRow (draft without price)', () => {
  it('accepts a null price', () => {
    expect(mapCourseRow({ ...ROW, status: 'draft', price_cents: null }).priceCents).toBeNull()
  })
})

const FIELDS = { title: 'Curso', description: null, priceCents: 9900, accessDurationDays: null }

function functionsClient(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(result)
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke }
}

describe('saveCourse', () => {
  it('invokes admin-courses with the request and maps the response', async () => {
    const { client, invoke } = functionsClient({ data: { courseId: 'c1', updatedAt: '2026-10-09T22:35:59.123456+00:00' }, error: null })
    const request = { action: 'update', courseId: 'c1', expectedUpdatedAt: '2026-01-02T00:00:00.000001+00:00', ...FIELDS } as const
    await expect(saveCourse(client, request)).resolves.toEqual({ courseId: 'c1', updatedAt: '2026-10-09T22:35:59.123456+00:00' })
    expect(invoke).toHaveBeenCalledWith('admin-courses', { body: request })
  })

  it('rejects a malformed response', async () => {
    const { client } = functionsClient({ data: { courseId: 'c1' }, error: null })
    await expect(saveCourse(client, { action: 'create', ...FIELDS })).rejects.toThrow('Invalid admin courses payload.')
  })

  it('reads the error envelope into a typed error', async () => {
    const context = new Response(JSON.stringify({ error: { code: 'stale_target', message: 'm', requestId: 'r1' } }), { status: 409 })
    const { client } = functionsClient({ data: null, error: { message: 'non-2xx', context } })
    await expect(saveCourse(client, { action: 'create', ...FIELDS })).rejects.toMatchObject({ code: 'stale_target', requestId: 'r1' })
  })

  it('maps a gateway 401 to unauthorized and unknown envelopes to internal', async () => {
    const gateway = functionsClient({ data: null, error: { message: 'x', context: new Response('{}', { status: 401 }) } })
    await expect(saveCourse(gateway.client, { action: 'create', ...FIELDS })).rejects.toMatchObject({ code: 'unauthorized' })
    const unknown = functionsClient({ data: null, error: { message: 'x', context: new Response(JSON.stringify({ error: { code: 'weird' } }), { status: 500 }) } })
    await expect(saveCourse(unknown.client, { action: 'create', ...FIELDS })).rejects.toMatchObject({ code: 'internal' })
  })

  it('maps a transport failure to internal', async () => {
    const { client } = functionsClient({ data: null, error: { message: 'network down' } })
    await expect(saveCourse(client, { action: 'create', ...FIELDS })).rejects.toMatchObject({ code: 'internal' })
  })
})

describe('parseErrorCode (module codes)', () => {
  it('matches module_not_empty and course_has_sales exactly', () => {
    expect(parseErrorCode({ message: 'module_not_empty' })).toBe('module_not_empty')
    expect(parseErrorCode({ message: 'x', hint: 'course_has_sales' })).toBe('course_has_sales')
    expect(parseErrorCode({ message: 'raise: course_has_sales' })).toBe('internal')
  })
})

describe('module mutations', () => {
  it('addModule calls app.staff_add_module', async () => {
    const { client, schema, rpc } = rpcClient({ data: [{ id: 'm9', position: 3 }], error: null })
    await expect(addModule(client, 'c1', 'Novo')).resolves.toBeUndefined()
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('staff_add_module', { p_course_id: 'c1', p_title: 'Novo' })
  })

  it('renameModule calls app.staff_rename_module', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    await renameModule(client, 'm1', 'Outro')
    expect(rpc).toHaveBeenCalledWith('staff_rename_module', { p_module_id: 'm1', p_title: 'Outro' })
  })

  it('reorderModules sends the full ordered id list', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    await reorderModules(client, 'c1', ['m2', 'm1'])
    expect(rpc).toHaveBeenCalledWith('staff_reorder_modules', { p_course_id: 'c1', p_module_ids: ['m2', 'm1'] })
  })

  it('setModuleArchived calls app.staff_set_module_archived', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    await setModuleArchived(client, 'm1', true)
    expect(rpc).toHaveBeenCalledWith('staff_set_module_archived', { p_module_id: 'm1', p_archived: true })
  })

  it('deleteModule calls app.staff_delete_module', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    await deleteModule(client, 'm1')
    expect(rpc).toHaveBeenCalledWith('staff_delete_module', { p_module_id: 'm1' })
  })

  it('throws typed errors with the stable code', async () => {
    const stale = rpcClient({ data: null, error: { message: 'stale_target', code: 'CR001' } })
    await expect(reorderModules(stale.client, 'c1', ['m1'])).rejects.toMatchObject({ code: 'stale_target' })
    const sales = rpcClient({ data: null, error: { message: 'course_has_sales', code: 'CR003' } })
    await expect(deleteModule(sales.client, 'm1')).rejects.toMatchObject({ code: 'course_has_sales' })
    const notEmpty = rpcClient({ data: null, error: { message: 'module_not_empty', code: 'CR002' } })
    await expect(deleteModule(notEmpty.client, 'm1')).rejects.toMatchObject({ code: 'module_not_empty' })
  })

  it('maps a 401 to unauthorized', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'JWT expired' }, status: 401 })
    await expect(renameModule(client, 'm1', 'X')).rejects.toMatchObject({ code: 'unauthorized' })
  })
})

describe('parseErrorCode (publish gate)', () => {
  it('matches publish_gate_violated exactly', () => {
    expect(parseErrorCode({ message: 'publish_gate_violated' })).toBe('publish_gate_violated')
    expect(parseErrorCode({ message: 'x', hint: 'publish_gate_violated' })).toBe('publish_gate_violated')
  })
})

describe('lesson mutations', () => {
  const FIELDS = { title: 'Aula', durationSeconds: 90, isFreePreview: true }
  const TOKEN = '2026-01-03T10:00:00.123456+00:00'

  it('addLesson calls app.staff_add_lesson', async () => {
    const { client, schema, rpc } = rpcClient({ data: [{ id: 'l9', position: 3, updated_at: TOKEN }], error: null })
    await expect(addLesson(client, 'm1', FIELDS, false)).resolves.toBeUndefined()
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('staff_add_lesson', {
      p_module_id: 'm1',
      p_title: 'Aula',
      p_duration_seconds: 90,
      p_is_free_preview: true,
      p_archived: false,
    })
  })

  it('updateLesson sends the updated_at token as read, untouched', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    await updateLesson(client, 'l1', TOKEN, { ...FIELDS, durationSeconds: null })
    expect(rpc).toHaveBeenCalledWith('staff_update_lesson', {
      p_lesson_id: 'l1',
      p_expected_updated_at: TOKEN,
      p_title: 'Aula',
      p_duration_seconds: null,
      p_is_free_preview: true,
    })
  })

  it('reorderLessons sends the full ordered id list of the module', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    await reorderLessons(client, 'm1', ['l2', 'l1'])
    expect(rpc).toHaveBeenCalledWith('staff_reorder_lessons', { p_module_id: 'm1', p_lesson_ids: ['l2', 'l1'] })
  })

  it('moveLesson calls app.staff_move_lesson', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    await moveLesson(client, 'l1', TOKEN, 'm2')
    expect(rpc).toHaveBeenCalledWith('staff_move_lesson', { p_lesson_id: 'l1', p_expected_updated_at: TOKEN, p_target_module_id: 'm2' })
  })

  it('setLessonArchived calls app.staff_set_lesson_archived', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    await setLessonArchived(client, 'l1', TOKEN, true)
    expect(rpc).toHaveBeenCalledWith('staff_set_lesson_archived', { p_lesson_id: 'l1', p_expected_updated_at: TOKEN, p_archived: true })
  })

  it('deleteLesson calls app.staff_delete_lesson', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    await deleteLesson(client, 'l1', TOKEN)
    expect(rpc).toHaveBeenCalledWith('staff_delete_lesson', { p_lesson_id: 'l1', p_expected_updated_at: TOKEN })
  })

  it('throws typed errors with the stable code', async () => {
    const stale = rpcClient({ data: null, error: { message: 'stale_target', code: 'CR001' } })
    await expect(updateLesson(stale.client, 'l1', TOKEN, FIELDS)).rejects.toMatchObject({ code: 'stale_target' })
    const gate = rpcClient({ data: null, error: { message: 'publish_gate_violated', code: 'CR004' } })
    await expect(addLesson(gate.client, 'm1', FIELDS, false)).rejects.toMatchObject({ code: 'publish_gate_violated' })
    const sales = rpcClient({ data: null, error: { message: 'course_has_sales', code: 'CR003' } })
    await expect(deleteLesson(sales.client, 'l1', TOKEN)).rejects.toMatchObject({ code: 'course_has_sales' })
  })

  it('maps a 401 to unauthorized', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'JWT expired' }, status: 401 })
    await expect(deleteLesson(client, 'l1', TOKEN)).rejects.toMatchObject({ code: 'unauthorized' })
  })
})

describe('setLessonVideo', () => {
  const TOKEN = '2026-01-03T10:00:00.123456+00:00'
  const RESULT = {
    provider: 'youtube',
    external_ref: 'dQw4w9WgXcQ',
    duplicates: [{ course_title: 'Curso B', lesson_title: 'Aula 3' }],
  }

  it('calls app.staff_set_lesson_video with the raw input and the token untouched', async () => {
    const { client, schema, rpc } = rpcClient({ data: RESULT, error: null })
    await setLessonVideo(client, 'l1', TOKEN, ' https://youtu.be/dQw4w9WgXcQ ')
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('staff_set_lesson_video', {
      p_lesson_id: 'l1',
      p_expected_updated_at: TOKEN,
      p_video_input: ' https://youtu.be/dQw4w9WgXcQ ',
    })
  })

  it('maps the response to camelCase, duplicates included', async () => {
    const { client } = rpcClient({ data: RESULT, error: null })
    await expect(setLessonVideo(client, 'l1', TOKEN, 'dQw4w9WgXcQ')).resolves.toEqual({
      provider: 'youtube',
      externalRef: 'dQw4w9WgXcQ',
      duplicates: [{ courseTitle: 'Curso B', lessonTitle: 'Aula 3' }],
    })
  })

  it.each([
    ['not an object', 'x'],
    ['unknown provider', { ...RESULT, provider: 'vimeo' }],
    ['empty reference', { ...RESULT, external_ref: '' }],
    ['duplicates not a list', { ...RESULT, duplicates: null }],
    ['malformed duplicate', { ...RESULT, duplicates: [{ course_title: 'A' }] }],
  ])('rejects a malformed payload: %s', async (_label, data) => {
    const { client } = rpcClient({ data, error: null })
    await expect(setLessonVideo(client, 'l1', TOKEN, 'dQw4w9WgXcQ')).rejects.toThrow('Invalid admin courses payload.')
  })

  it('throws typed errors with the stable code', async () => {
    const invalid = rpcClient({ data: null, error: { message: 'invalid_input', code: '22023' } })
    await expect(setLessonVideo(invalid.client, 'l1', TOKEN, 'x')).rejects.toMatchObject({ code: 'invalid_input' })
    const stale = rpcClient({ data: null, error: { message: 'stale_target', code: 'CR001' } })
    await expect(setLessonVideo(stale.client, 'l1', TOKEN, 'dQw4w9WgXcQ')).rejects.toMatchObject({ code: 'stale_target' })
  })
})
