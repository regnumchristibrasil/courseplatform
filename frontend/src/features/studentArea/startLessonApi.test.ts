import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AdminUsersApiError } from '../admin/users/api'
import { startLesson } from './startLessonApi'

function buildFakeClient(response: { data: unknown; error: unknown; status?: number }) {
  const rpc = vi.fn().mockResolvedValue(response)
  const schema = vi.fn().mockReturnValue({ rpc })
  return { client: { schema } as unknown as SupabaseClient, schema, rpc }
}

describe('startLesson', () => {
  it('calls app.start_lesson and reports that progress was registered', async () => {
    const { client, schema, rpc } = buildFakeClient({ data: [{ lesson_id: 'l1' }], error: null })
    await expect(startLesson(client, 'l1')).resolves.toBe(true)
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('start_lesson', { p_lesson_id: 'l1' })
  })

  it('reports false when the server returns zero rows (no effect)', async () => {
    const { client } = buildFakeClient({ data: [], error: null })
    await expect(startLesson(client, 'l1')).resolves.toBe(false)
  })

  it('maps HTTP 401 to a typed unauthorized error', async () => {
    const { client } = buildFakeClient({ data: null, error: { code: '42501', message: 'x', hint: null }, status: 401 })
    await expect(startLesson(client, 'l1')).rejects.toBeInstanceOf(AdminUsersApiError)
  })

  it('throws a generic error for other failures', async () => {
    const { client } = buildFakeClient({ data: null, error: { code: 'XX000', message: 'boom', hint: null }, status: 500 })
    await expect(startLesson(client, 'l1')).rejects.toThrow('Failed to start lesson: boom')
  })
})
