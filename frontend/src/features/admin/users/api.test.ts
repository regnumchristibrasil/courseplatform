import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AdminUsersApiError, listAdminUsers, mapUserRow, parseErrorCode, setUserActive, setUserRole } from './api'

const ROW = {
  id: 'u1', email: 'a@b.co', full_name: 'Ana', role: 'tutor', is_active: true,
  created_at: '2026-01-01T00:00:00Z', total_count: 42,
}

function rpcClient(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  const schema = vi.fn().mockReturnValue({ rpc })
  const invoke = vi.fn()
  return { client: { schema, functions: { invoke } } as unknown as SupabaseClient, schema, rpc, invoke }
}

function efClient(response: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(response)
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke }
}

describe('parseErrorCode', () => {
  const CODES = ['stale_target', 'forbidden', 'self_target', 'last_superadmin', 'actor_inactive', 'invalid_input', 'auth_sync_failed', 'not_found']

  it.each(CODES)('matches %s exactly in message or hint', (code) => {
    expect(parseErrorCode({ message: code })).toBe(code)
    expect(parseErrorCode({ message: 'x', hint: code })).toBe(code)
  })

  it.each(CODES)('does not match %s as a substring', (code) => {
    expect(parseErrorCode({ message: `raise: ${code}` })).toBe('internal')
    expect(parseErrorCode({ message: 'x', hint: `${code}_extra` })).toBe('internal')
  })

  it('maps the real RPC 403 shape to forbidden', () => {
    expect(parseErrorCode({ code: '42501', hint: 'forbidden', message: 'forbidden' }, 403)).toBe('forbidden')
  })

  it('maps the real stale_target shape (SQLSTATE AD003)', () => {
    expect(parseErrorCode({ code: 'AD003', hint: 'stale_target', message: 'stale_target' }, 409)).toBe('stale_target')
  })

  it('maps a bare PostgREST 42501 without hint to forbidden', () => {
    expect(parseErrorCode({ code: '42501', message: 'insufficient privilege' }, 403)).toBe('forbidden')
  })

  it('maps the real anon 401 shape to unauthorized (not forbidden)', () => {
    const anon = { code: '42501', message: 'permission denied for schema app', hint: null }
    expect(parseErrorCode(anon, 401)).toBe('unauthorized')
  })

  it('returns internal for unknown or missing', () => {
    expect(parseErrorCode({ message: 'boom' })).toBe('internal')
    expect(parseErrorCode(null)).toBe('internal')
    expect(parseErrorCode(undefined)).toBe('internal')
  })
})

describe('mapUserRow', () => {
  it('maps snake_case to contract row', () => {
    expect(mapUserRow(ROW)).toEqual({
      userId: 'u1', email: 'a@b.co', fullName: 'Ana', role: 'tutor', isActive: true, createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('strips bidi control characters from name and email', () => {
    const mapped = mapUserRow({ ...ROW, email: 'a\u202Eb@c.co\u2066', full_name: '\u200FAna\u202A\u061C' })
    expect(mapped.email).toBe('ab@c.co')
    expect(mapped.fullName).toBe('Ana')
  })

  it('accepts null full_name', () => {
    expect(mapUserRow({ ...ROW, full_name: null }).fullName).toBeNull()
  })

  it.each([
    ['bad role', { ...ROW, role: 'root' }],
    ['missing id', { ...ROW, id: undefined }],
    ['non-boolean active', { ...ROW, is_active: 'yes' }],
    ['non-object', 'x'],
    ['null', null],
  ])('rejects %s', (_n, bad) => {
    expect(() => mapUserRow(bad)).toThrow(/Invalid admin users payload/)
  })
})

describe('listAdminUsers', () => {
  it('calls admin_list_users in the app schema with p_ params', async () => {
    const { client, schema, rpc } = rpcClient({ data: [ROW], error: null })
    const res = await listAdminUsers(client, { search: 'an', role: 'tutor', active: true, limit: 20, offset: 40 })
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('admin_list_users', {
      p_search: 'an', p_role: 'tutor', p_active: true, p_limit: 20, p_offset: 40,
    })
    expect(res.total).toBe(42)
    expect(res.users).toHaveLength(1)
  })

  it('sends null for absent filters', async () => {
    const { client, rpc } = rpcClient({ data: [], error: null })
    await listAdminUsers(client, { limit: 20, offset: 0 })
    expect(rpc).toHaveBeenCalledWith('admin_list_users', {
      p_search: null, p_role: null, p_active: null, p_limit: 20, p_offset: 0,
    })
  })

  it('returns total 0 for empty result', async () => {
    const { client } = rpcClient({ data: [], error: null })
    expect(await listAdminUsers(client, { limit: 20, offset: 0 })).toEqual({ users: [], total: 0 })
  })

  it('rejects out-of-range input before calling the backend', async () => {
    const { client, rpc } = rpcClient({ data: [], error: null })
    await expect(listAdminUsers(client, { limit: 51, offset: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(listAdminUsers(client, { limit: 20, offset: -1 })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a page beyond the cap, an overlong search and a too-short search', async () => {
    const { client, rpc } = rpcClient({ data: [], error: null })
    await expect(listAdminUsers(client, { limit: 20, offset: 10_000 * 20 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(listAdminUsers(client, { search: 'x'.repeat(101), limit: 20, offset: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(listAdminUsers(client, { search: 'a', limit: 20, offset: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts the last allowed page and a 100 character search', async () => {
    const { client, rpc } = rpcClient({ data: [], error: null })
    await listAdminUsers(client, { search: 'x'.repeat(100), limit: 20, offset: 9_999 * 20 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('maps the real RPC 403, stale and anon 401 responses', async () => {
    const req = { limit: 20, offset: 0 }
    const forbidden = rpcClient({ data: null, error: { code: '42501', hint: 'forbidden', message: 'forbidden' } })
    await expect(listAdminUsers(forbidden.client, req)).rejects.toMatchObject({ code: 'forbidden' })
    const anon = rpcClient({ data: null, error: { code: '42501', message: 'permission denied for schema app', hint: null } })
    anon.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for schema app', hint: null }, status: 401 })
    await expect(listAdminUsers(anon.client, req)).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Sua sessão expirou. Entre novamente.',
    })
  })

  it('maps stale_target on set role with the real AD003 shape', async () => {
    const { client } = rpcClient({ data: null, error: { code: 'AD003', hint: 'stale_target', message: 'stale_target' } })
    await expect(setUserRole(client, { userId: 'u1', role: 'admin', expectedRole: 'tutor' }))
      .rejects.toMatchObject({ code: 'stale_target' })
  })

  it('throws AdminUsersApiError with parsed code on rpc error', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'permission', hint: 'forbidden' } })
    const err = await listAdminUsers(client, { limit: 20, offset: 0 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AdminUsersApiError)
    expect(err).toMatchObject({ code: 'forbidden' })
  })

  it('throws on malformed payload', async () => {
    const { client } = rpcClient({ data: [{ ...ROW, total_count: 'x' }], error: null })
    await expect(listAdminUsers(client, { limit: 20, offset: 0 })).rejects.toThrow(/Invalid admin users payload/)
  })

  it('throws when data is not an array', async () => {
    const { client } = rpcClient({ data: { foo: 1 }, error: null })
    await expect(listAdminUsers(client, { limit: 20, offset: 0 })).rejects.toThrow(/Invalid admin users payload/)
  })
})

describe('setUserRole', () => {
  it('calls admin_set_user_role with p_ params', async () => {
    const { client, schema, rpc } = rpcClient({ data: [{ user_id: 'u1', role: 'admin' }], error: null })
    const res = await setUserRole(client, { userId: 'u1', role: 'admin', expectedRole: 'tutor', reason: 'promo' })
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('admin_set_user_role', {
      p_target: 'u1', p_role: 'admin', p_expected_role: 'tutor', p_reason: 'promo',
    })
    expect(res).toEqual({ userId: 'u1', role: 'admin' })
  })

  it('sends null reason when absent', async () => {
    const { client, rpc } = rpcClient({ data: [{ user_id: 'u1', role: 'admin' }], error: null })
    await setUserRole(client, { userId: 'u1', role: 'admin', expectedRole: 'tutor' })
    expect(rpc).toHaveBeenCalledWith('admin_set_user_role', expect.objectContaining({ p_reason: null }))
  })

  it('maps stale_target from rpc error', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'stale_target' } })
    await expect(setUserRole(client, { userId: 'u1', role: 'admin', expectedRole: 'tutor' }))
      .rejects.toMatchObject({ code: 'stale_target' })
  })

  it('rejects invalid role and long reason locally', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null })
    await expect(setUserRole(client, { userId: 'u1', role: 'root' as never, expectedRole: 'tutor' }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    await expect(setUserRole(client, { userId: 'u1', role: 'admin', expectedRole: 'tutor', reason: 'x'.repeat(501) }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    await expect(setUserRole(client, { userId: '', role: 'admin', expectedRole: 'tutor' }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('setUserActive', () => {
  it('invokes the admin-users edge function', async () => {
    const { client, invoke } = efClient({ data: { userId: 'u1', isActive: false }, error: null })
    const res = await setUserActive(client, { userId: 'u1', active: false, expectedActive: true, reason: 'abuse' })
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'set_active', userId: 'u1', active: false, expectedActive: true, reason: 'abuse' },
    })
    expect(res).toEqual({ userId: 'u1', isActive: false })
  })

  it('omits reason when absent', async () => {
    const { client, invoke } = efClient({ data: { userId: 'u1', isActive: true }, error: null })
    await setUserActive(client, { userId: 'u1', active: true, expectedActive: false })
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty('reason')
  })

  it('parses the error envelope from FunctionsHttpError context', async () => {
    const context = new Response(JSON.stringify({ error: { code: 'auth_sync_failed', message: 'm', requestId: 'r1' } }), { status: 502 })
    const { client } = efClient({ data: null, error: { name: 'FunctionsHttpError', message: 'non-2xx', context } })
    await expect(setUserActive(client, { userId: 'u1', active: false, expectedActive: true }))
      .rejects.toMatchObject({ code: 'auth_sync_failed', requestId: 'r1' })
  })

  it('maps unknown envelope code to internal', async () => {
    const context = new Response(JSON.stringify({ error: { code: 'weird', message: 'm', requestId: 'r' } }), { status: 500 })
    const { client } = efClient({ data: null, error: { message: 'non-2xx', context } })
    await expect(setUserActive(client, { userId: 'u1', active: false, expectedActive: true }))
      .rejects.toMatchObject({ code: 'internal' })
  })

  it('maps a platform gateway 401 (no .error envelope) to unauthorized', async () => {
    const context = new Response(
      JSON.stringify({ code: 'UNAUTHORIZED_INVALID_JWT_FORMAT', message: 'Invalid JWT format' }),
      { status: 401 },
    )
    const { client } = efClient({ data: null, error: { name: 'FunctionsHttpError', message: 'non-2xx', context } })
    await expect(setUserActive(client, { userId: 'u1', active: false, expectedActive: true }))
      .rejects.toMatchObject({ code: 'unauthorized', message: 'Sua sessão expirou. Entre novamente.' })
  })

  it('maps non-JSON failures (network) to internal', async () => {
    const { client } = efClient({ data: null, error: { message: 'Failed to fetch' } })
    await expect(setUserActive(client, { userId: 'u1', active: false, expectedActive: true }))
      .rejects.toMatchObject({ code: 'internal' })
  })

  it('rejects malformed success payload', async () => {
    const { client } = efClient({ data: { nope: true }, error: null })
    await expect(setUserActive(client, { userId: 'u1', active: false, expectedActive: true }))
      .rejects.toThrow(/Invalid admin users payload/)
  })

  it('rejects invalid input locally', async () => {
    const { client, invoke } = efClient({ data: null, error: null })
    await expect(setUserActive(client, { userId: 'u1', active: false, expectedActive: true, reason: 'x'.repeat(501) }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    expect(invoke).not.toHaveBeenCalled()
  })
})
