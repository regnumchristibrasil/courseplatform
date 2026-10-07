import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCurrentAccess } from './features/authz/currentAccessApi'
import { listAdminUsers } from './features/admin/users/api'
import { App } from './App'

vi.mock('./lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('./features/analytics/PostHogProvider', () => ({ PostHogProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./features/auth/AuthProvider', async () => {
  const { AuthContext: Ctx } = await import('./features/auth/AuthContext')
  const { buildAuth: build } = await import('./test/renderWithProviders')
  return { AuthProvider: ({ children }: { children: ReactNode }) => <Ctx.Provider value={build()}>{children}</Ctx.Provider> }
})
vi.mock('./features/authz/currentAccessApi', () => ({ fetchCurrentAccess: vi.fn() }))
vi.mock('./features/admin/users/api', async (orig) => ({
  ...(await orig<typeof import('./features/admin/users/api')>()),
  listAdminUsers: vi.fn(),
}))
vi.mock('./lib/queryClient', async () => {
  const { QueryClient } = await import('@tanstack/react-query')
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [], total: 0 })
})

describe('App admin routes', () => {
  it('redirects /admin to /admin/users for staff', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'admin', isActive: true })
    window.history.pushState({}, '', '/admin')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Usuários' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/admin/users')
  })

  it('renders NotFound at /admin/users for non-staff', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'student', isActive: true })
    window.history.pushState({}, '', '/admin/users')
    render(<App />)
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument()
  })
})
