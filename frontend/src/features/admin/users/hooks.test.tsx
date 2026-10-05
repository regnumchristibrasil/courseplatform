import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../auth/AuthContext'
import { buildAuth } from '../../../test/renderWithProviders'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_ACCESS_QUERY_KEY } from '../../authz/queryKeys'
import { AdminUsersApiError, listAdminUsers, setUserActive, setUserRole } from './api'
import { ADMIN_USERS_QUERY_KEY } from './queryKeys'
import { useAdminUsers } from './useAdminUsers'
import { useSetUserActive } from './useSetUserActive'
import { useSetUserRole } from './useSetUserRole'

vi.mock('../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  listAdminUsers: vi.fn(),
  setUserRole: vi.fn(),
  setUserActive: vi.fn(),
}))

function setup(initial = '/', signOut = vi.fn().mockResolvedValue({ error: null })) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={buildAuth({ signOut })}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>
  )
  return { wrapper, invalidate, queryClient, signOut }
}

beforeEach(() => vi.resetAllMocks())

describe('useAdminUsers', () => {
  it('reads filters from the URL and queries with the mapped request', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [], total: 0 })
    const { wrapper } = setup('/?q=ana&role=tutor&active=true&page=2&limit=10')
    const { result } = renderHook(() => useAdminUsers(), { wrapper })
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
    expect(listAdminUsers).toHaveBeenCalledWith(
      { __fake: true },
      { search: 'ana', role: 'tutor', active: true, limit: 10, offset: 10 },
    )
    expect(result.current.filters.page).toBe(2)
  })

  it('clamps an oversized limit', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [], total: 0 })
    const { wrapper } = setup('/?limit=500')
    const { result } = renderHook(() => useAdminUsers(), { wrapper })
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
    expect(result.current.filters.limit).toBe(50)
  })

  it('setFilters writes the URL and resets page when a filter changes', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [], total: 0 })
    const { wrapper } = setup('/?page=3')
    const { result } = renderHook(() => useAdminUsers(), { wrapper })
    act(() => result.current.setFilters({ role: 'admin' }))
    await waitFor(() => expect(result.current.filters.role).toBe('admin'))
    expect(result.current.filters.page).toBe(1)
  })

  it('setFilters keeps page when only page changes', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [], total: 0 })
    const { wrapper } = setup('/')
    const { result } = renderHook(() => useAdminUsers(), { wrapper })
    act(() => result.current.setFilters({ page: 4 }))
    await waitFor(() => expect(result.current.filters.page).toBe(4))
  })

  it('uses a key rooted at ADMIN_USERS_QUERY_KEY', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [], total: 0 })
    const { wrapper, queryClient } = setup('/')
    const { result } = renderHook(() => useAdminUsers(), { wrapper })
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true))
    expect(queryClient.getQueryCache().findAll({ queryKey: ADMIN_USERS_QUERY_KEY })).toHaveLength(1)
    expect(queryClient.getQueryCache().getAll()[0].queryKey).toEqual([
      'admin', 'users', 'list', { limit: 20, offset: 0 },
    ])
  })
})

describe('session expiry (HTTP 401)', () => {
  it('signs out when the list query fails with unauthorized', async () => {
    vi.mocked(listAdminUsers).mockRejectedValue(new AdminUsersApiError('unauthorized', 'x'))
    const { wrapper, signOut } = setup('/')
    renderHook(() => useAdminUsers(), { wrapper })
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
  })

  it('does not sign out for other list errors', async () => {
    vi.mocked(listAdminUsers).mockRejectedValue(new AdminUsersApiError('forbidden', 'x'))
    const { wrapper, signOut } = setup('/')
    const { result } = renderHook(() => useAdminUsers(), { wrapper })
    await waitFor(() => expect(result.current.query.isError).toBe(true))
    expect(signOut).not.toHaveBeenCalled()
  })

  it.each([
    ['role', () => vi.mocked(setUserRole), () => useSetUserRole(), { userId: 'u1', role: 'admin', expectedRole: 'tutor' }],
    ['active', () => vi.mocked(setUserActive), () => useSetUserActive(), { userId: 'u1', active: false, expectedActive: true }],
  ] as const)('signs out when the %s mutation fails with unauthorized', async (_name, mocked, hook, vars) => {
    mocked().mockRejectedValue(new AdminUsersApiError('unauthorized', 'x'))
    const { wrapper, signOut } = setup()
    const { result } = renderHook(() => hook(), { wrapper })
    await act(() => (result.current.mutateAsync as (v: unknown) => Promise<unknown>)(vars).catch(() => undefined))
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})

describe('useSetUserRole', () => {
  const vars = { userId: 'u1', role: 'admin', expectedRole: 'tutor' } as const

  it('sends expectedRole and invalidates the list on success', async () => {
    vi.mocked(setUserRole).mockResolvedValue({ userId: 'u1', role: 'admin' })
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useSetUserRole(), { wrapper })
    await act(() => result.current.mutateAsync(vars))
    expect(setUserRole).toHaveBeenCalledWith({ __fake: true }, vars)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ADMIN_USERS_QUERY_KEY })
  })

  it('invalidates the list on a stale_target failure so the table shows the truth', async () => {
    vi.mocked(setUserRole).mockRejectedValue(new AdminUsersApiError('stale_target', 'x'))
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useSetUserRole(), { wrapper })
    await act(() => result.current.mutateAsync(vars).catch(() => undefined))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ADMIN_USERS_QUERY_KEY })
  })

  it.each(['last_superadmin', 'self_target', 'invalid_input', 'internal'] as const)(
    'does not invalidate the list on %s',
    async (code) => {
      vi.mocked(setUserRole).mockRejectedValue(new AdminUsersApiError(code, 'x'))
      const { wrapper, invalidate } = setup()
      const { result } = renderHook(() => useSetUserRole(), { wrapper })
      await act(() => result.current.mutateAsync(vars).catch(() => undefined))
      expect(invalidate).not.toHaveBeenCalled()
    },
  )

  it.each(['forbidden', 'actor_inactive'] as const)('also invalidates [me] on %s', async (code) => {
    vi.mocked(setUserRole).mockRejectedValue(new AdminUsersApiError(code, 'x'))
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useSetUserRole(), { wrapper })
    await act(() => result.current.mutateAsync(vars).catch(() => undefined))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: CURRENT_ACCESS_QUERY_KEY })
  })
})

describe('useSetUserActive', () => {
  const vars = { userId: 'u1', active: false, expectedActive: true } as const

  it('sends expectedActive and invalidates the list on success', async () => {
    vi.mocked(setUserActive).mockResolvedValue({ userId: 'u1', isActive: false })
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useSetUserActive(), { wrapper })
    await act(() => result.current.mutateAsync(vars))
    expect(setUserActive).toHaveBeenCalledWith({ __fake: true }, vars)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ADMIN_USERS_QUERY_KEY })
  })

  it.each(['stale_target', 'auth_sync_failed'] as const)('invalidates the list on %s', async (code) => {
    vi.mocked(setUserActive).mockRejectedValue(new AdminUsersApiError(code, 'x'))
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useSetUserActive(), { wrapper })
    await act(() => result.current.mutateAsync(vars).catch(() => undefined))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ADMIN_USERS_QUERY_KEY })
  })

  it('does not touch the cache optimistically (pessimistic)', async () => {
    let resolve!: (v: { userId: string; isActive: boolean }) => void
    vi.mocked(setUserActive).mockReturnValue(new Promise((r) => { resolve = r }))
    const { wrapper, invalidate, queryClient } = setup()
    const setData = vi.spyOn(queryClient, 'setQueryData')
    const { result } = renderHook(() => useSetUserActive(), { wrapper })
    act(() => { result.current.mutate(vars) })
    expect(setData).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => resolve({ userId: 'u1', isActive: false }))
  })

  it.each(['forbidden', 'actor_inactive'] as const)('also invalidates [me] on %s', async (code) => {
    vi.mocked(setUserActive).mockRejectedValue(new AdminUsersApiError(code, 'x'))
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useSetUserActive(), { wrapper })
    await act(() => result.current.mutateAsync(vars).catch(() => undefined))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: CURRENT_ACCESS_QUERY_KEY })
  })
})
