import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCurrentAccess } from './features/authz/currentAccessApi'
import { App } from './App'

vi.mock('./lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('./features/analytics/PostHogProvider', () => ({ PostHogProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./features/auth/AuthProvider', async () => {
  const { AuthContext: Ctx } = await import('./features/auth/AuthContext')
  const { buildAuth: build } = await import('./test/renderWithProviders')
  return { AuthProvider: ({ children }: { children: ReactNode }) => <Ctx.Provider value={build()}>{children}</Ctx.Provider> }
})
vi.mock('./features/authz/currentAccessApi', () => ({ fetchCurrentAccess: vi.fn() }))
// Chunk lazy que nunca resolve: mantém o fallback do Suspense visível.
vi.mock('./features/admin/users/AdminUsersPage', () => new Promise(() => {}))
vi.mock('./lib/queryClient', async () => {
  const { QueryClient } = await import('@tanstack/react-query')
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }
})

beforeEach(() => vi.resetAllMocks())

describe('App Suspense fallback', () => {
  it('renders a labelled spinner while the admin chunk loads', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'admin', isActive: true })
    window.history.pushState({}, '', '/admin/users')
    render(<App />)
    expect(await screen.findByRole('status', { name: 'Carregando página...' })).toBeInTheDocument()
  })
})
