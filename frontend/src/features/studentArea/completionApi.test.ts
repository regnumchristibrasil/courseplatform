import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AdminUsersApiError } from '../admin/users/api'
import { setLessonCompleted } from './completionApi'

function buildFakeClient(response: { data: unknown; error: unknown; status?: number }) {
  const rpc = vi.fn().mockResolvedValue(response)
  const schema = vi.fn().mockReturnValue({ rpc })
  return { client: { schema } as unknown as SupabaseClient, schema, rpc }
}

describe('setLessonCompleted', () => {
  it('calls app.complete_lesson when completing and reports the change was applied', async () => {
    const { client, schema, rpc } = buildFakeClient({ data: [{ lesson_id: 'l1' }], error: null })
    await expect(setLessonCompleted(client, 'l1', true)).resolves.toBe(true)
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('complete_lesson', { p_lesson_id: 'l1' })
  })

  it('calls app.uncomplete_lesson when unmarking', async () => {
    const { client, rpc } = buildFakeClient({ data: [{ lesson_id: 'l1' }], error: null })
    await expect(setLessonCompleted(client, 'l1', false)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('uncomplete_lesson', { p_lesson_id: 'l1' })
  })

  it('reports false when the server returns zero rows (no effect)', async () => {
    const { client } = buildFakeClient({ data: [], error: null })
    await expect(setLessonCompleted(client, 'l1', true)).resolves.toBe(false)
  })

  it('maps HTTP 401 to a typed unauthorized error', async () => {
    const { client } = buildFakeClient({ data: null, error: { code: '42501', message: 'x', hint: null }, status: 401 })
    await expect(setLessonCompleted(client, 'l1', true)).rejects.toBeInstanceOf(AdminUsersApiError)
  })

  it('throws a generic error for other failures', async () => {
    const { client } = buildFakeClient({ data: null, error: { code: 'XX000', message: 'boom', hint: null }, status: 500 })
    await expect(setLessonCompleted(client, 'l1', false)).rejects.toThrow('Failed to update lesson completion: boom')
  })
})
