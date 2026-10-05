import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthContext'
import { buildAuth as buildAuthValue, buildSession, buildUser } from '../../test/renderWithProviders'
import { fetchCurrentAccess } from './currentAccessApi'
import { CURRENT_ACCESS_QUERY_KEY, currentAccessKey } from './queryKeys'
import { useCurrentAccess } from './useCurrentAccess'

vi.mock('./currentAccessApi', () => ({ fetchCurrentAccess: vi.fn() }))

function buildAuth(userId: string | null): AuthContextValue {
  const user = userId ? buildUser(userId) : null
  return buildAuthValue({ session: user ? buildSession(user) : null, user })
}

function wrapperFor(queryClient: QueryClient, userId: string | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider value={buildAuth(userId)}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </AuthContext.Provider>
    )
  }
}

describe('useCurrentAccess', () => {
  it('keeps the constant ["me"] root key', () => {
    expect(CURRENT_ACCESS_QUERY_KEY).toEqual(['me'])
  })

  it('fetches access for an authenticated user', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'admin', isActive: true })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useCurrentAccess(), { wrapper: wrapperFor(queryClient, 'u1') })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ role: 'admin', isActive: true })
    expect(queryClient.getQueryData(['me', 'u1'])).toEqual({ role: 'admin', isActive: true })
  })

  it('scopes the key per user while staying under the ["me"] root', () => {
    expect(currentAccessKey('u1')).toEqual(['me', 'u1'])
    expect(currentAccessKey('u1').slice(0, 1)).toEqual([...CURRENT_ACCESS_QUERY_KEY])
  })

  it('uses a short staleTime (10s) so a demoted admin loses the UI quickly', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'admin', isActive: true })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
    const { result } = renderHook(() => useCurrentAccess(), { wrapper: wrapperFor(queryClient, 'u1') })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryCache().find({ queryKey: ['me', 'u1'] })?.observers[0]?.options.staleTime).toBe(10_000)
  })

  it('does not fetch without a session', () => {
    vi.mocked(fetchCurrentAccess).mockClear()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderHook(() => useCurrentAccess(), { wrapper: wrapperFor(queryClient, null) })

    expect(fetchCurrentAccess).not.toHaveBeenCalled()
  })
})
