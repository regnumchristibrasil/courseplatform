import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AdminCoursesApiError, listStaffCourses, mapCourseRow, parseErrorCode } from './api'

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
