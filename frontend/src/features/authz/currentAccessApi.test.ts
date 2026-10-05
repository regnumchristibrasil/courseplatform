import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AdminUsersApiError } from '../admin/users/api'
import { fetchCurrentAccess } from './currentAccessApi'

function buildFakeClient(response: { data: unknown; error: unknown; status?: number }) {
  const rpc = vi.fn().mockResolvedValue(response)
  const schema = vi.fn().mockReturnValue({ rpc })
  return { client: { schema } as unknown as SupabaseClient, schema, rpc }
}

describe('fetchCurrentAccess', () => {
  it('calls app.current_access and maps the row', async () => {
    const { client, schema, rpc } = buildFakeClient({
      data: { role: 'admin', is_active: true },
      error: null,
    })

    await expect(fetchCurrentAccess(client)).resolves.toEqual({ role: 'admin', isActive: true })
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('current_access')
  })

  it('accepts a single-row array response', async () => {
    const { client } = buildFakeClient({
      data: [{ role: 'student', is_active: false }],
      error: null,
    })

    await expect(fetchCurrentAccess(client)).resolves.toEqual({ role: 'student', isActive: false })
  })

  it('returns null only when the RPC answers without a row', async () => {
    const { client } = buildFakeClient({ data: null, error: null })
    await expect(fetchCurrentAccess(client)).resolves.toBeNull()

    const empty = buildFakeClient({ data: [], error: null })
    await expect(fetchCurrentAccess(empty.client)).resolves.toBeNull()
  })

  it('maps the anon HTTP 401 "permission denied for schema app" to a typed unauthorized error', async () => {
    const { client } = buildFakeClient({
      data: null,
      error: { code: '42501', message: 'permission denied for schema app', hint: null },
      status: 401,
    })
    const failure = await fetchCurrentAccess(client).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(AdminUsersApiError)
    expect(failure).toMatchObject({ code: 'unauthorized' })
  })

  it('does not map an authenticated 403 forbidden to unauthorized', async () => {
    const { client } = buildFakeClient({
      data: null,
      error: { code: '42501', message: 'permission denied for schema app', hint: null },
      status: 403,
    })
    const failure = await fetchCurrentAccess(client).catch((e: unknown) => e)
    expect(failure).not.toBeInstanceOf(AdminUsersApiError)
    expect((failure as Error).message).toBe(
      'Failed to load current access: permission denied for schema app',
    )
  })

  it('throws on rpc error', async () => {
    const { client } = buildFakeClient({ data: null, error: { message: 'boom' } })
    await expect(fetchCurrentAccess(client)).rejects.toThrow('Failed to load current access: boom')
  })

  it('throws on an unknown role or malformed payload', async () => {
    const bad = buildFakeClient({ data: { role: 'root', is_active: true }, error: null })
    await expect(fetchCurrentAccess(bad.client)).rejects.toThrow('Invalid current access payload')

    const malformed = buildFakeClient({ data: { role: 'admin', is_active: 'yes' }, error: null })
    await expect(fetchCurrentAccess(malformed.client)).rejects.toThrow('Invalid current access payload')
  })
})
