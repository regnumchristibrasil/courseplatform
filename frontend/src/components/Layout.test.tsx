import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from '@supabase/supabase-js'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../features/auth/AuthContext'
import { COMPANY_NAME } from '../config/brand'
import { fetchCurrentAccess } from '../features/authz/currentAccessApi'
import { Layout } from './Layout'

vi.mock('../features/authz/currentAccessApi', () => ({ fetchCurrentAccess: vi.fn() }))

function buildAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: null,
    user: null,
    isLoading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  }
}

function renderLayout(authValue: AuthContextValue, initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<p>Nested route content</p>} />
              <Route path="/login" element={<p>Login content</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  )
}

describe('Layout', () => {
  it('renders the brand name', () => {
    renderLayout(buildAuthValue())
    expect(screen.getByText(COMPANY_NAME)).toBeInTheDocument()
  })

  it('renders the nested route content via Outlet', () => {
    renderLayout(buildAuthValue())
    expect(screen.getByText('Nested route content')).toBeInTheDocument()
  })

  it('shows login/signup links when unauthenticated', () => {
    renderLayout(buildAuthValue({ session: null }))

    expect(screen.getByRole('link', { name: /entrar/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /cadastr/i })).toBeInTheDocument()
  })

  it('shows the user email and a sign-out action when authenticated', () => {
    const user = { id: 'user-1', email: 'user@example.com' } as unknown as User
    renderLayout(buildAuthValue({ session: { user } as never, user }))

    expect(screen.getByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sair/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /entrar/i })).not.toBeInTheDocument()
  })

  it('calls signOut when the sign-out button is clicked', async () => {
    const userInteraction = userEvent.setup()
    const authUser = { id: 'user-1', email: 'user@example.com' } as unknown as User
    const authValue = buildAuthValue({ session: { user: authUser } as never, user: authUser })
    renderLayout(authValue)

    await userInteraction.click(screen.getByRole('button', { name: /sair/i }))

    expect(authValue.signOut).toHaveBeenCalledTimes(1)
  })

  describe('header', () => {
    it('links the brand to the home page and reserves a decorative logo slot', () => {
      renderLayout(buildAuthValue())
      const brand = screen.getByRole('link', { name: COMPANY_NAME })
      expect(brand).toHaveAttribute('href', '/')
      expect(brand.querySelector('[data-testid="logo-placeholder"]')).toHaveAttribute('aria-hidden', 'true')
    })

    it('exposes the main navigation landmark', () => {
      renderLayout(buildAuthValue())
      expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument()
    })

    it('marks only the current route as the active item', () => {
      renderLayout(buildAuthValue(), '/login')
      expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByRole('link', { name: 'Catálogo' })).not.toHaveAttribute('aria-current')
      expect(screen.getByRole('link', { name: 'Cadastrar' })).not.toHaveAttribute('aria-current')
    })

    it('marks the catalog as active on the home page', () => {
      renderLayout(buildAuthValue(), '/')
      expect(screen.getByRole('link', { name: 'Catálogo' })).toHaveAttribute('aria-current', 'page')
    })
  })

  describe('admin link', () => {
    beforeEach(() => vi.mocked(fetchCurrentAccess).mockReset())

    const authUser = { id: 'user-1', email: 'user@example.com' } as unknown as User
    const authed = () => buildAuthValue({ session: { user: authUser } as never, user: authUser })

    it.each(['admin', 'superadmin'] as const)('shows Administração for active %s', async (role) => {
      vi.mocked(fetchCurrentAccess).mockResolvedValue({ role, isActive: true })
      renderLayout(authed())
      expect(await screen.findByRole('link', { name: 'Administração' })).toHaveAttribute('href', '/admin/users')
    })

    it.each(['student', 'tutor'] as const)('hides Administração for %s', async (role) => {
      vi.mocked(fetchCurrentAccess).mockResolvedValue({ role, isActive: true })
      renderLayout(authed())
      await vi.waitFor(() => expect(fetchCurrentAccess).toHaveBeenCalled())
      expect(screen.queryByRole('link', { name: 'Administração' })).not.toBeInTheDocument()
    })

    it('hides Administração for an inactive admin', async () => {
      vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'admin', isActive: false })
      renderLayout(authed())
      await vi.waitFor(() => expect(fetchCurrentAccess).toHaveBeenCalled())
      expect(screen.queryByRole('link', { name: 'Administração' })).not.toBeInTheDocument()
    })

    it.each(['tutor', 'admin', 'superadmin'] as const)('shows Cursos for active %s', async (role) => {
      vi.mocked(fetchCurrentAccess).mockResolvedValue({ role, isActive: true })
      renderLayout(authed())
      expect(await screen.findByRole('link', { name: 'Cursos' })).toHaveAttribute('href', '/admin/courses')
    })

    it('hides Cursos for students and inactive tutors', async () => {
      vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'student', isActive: true })
      const first = renderLayout(authed())
      await vi.waitFor(() => expect(fetchCurrentAccess).toHaveBeenCalled())
      expect(screen.queryByRole('link', { name: 'Cursos' })).not.toBeInTheDocument()
      first.unmount()
      vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'tutor', isActive: false })
      renderLayout(authed())
      await vi.waitFor(() => expect(fetchCurrentAccess).toHaveBeenCalledTimes(2))
      expect(screen.queryByRole('link', { name: 'Cursos' })).not.toBeInTheDocument()
    })

    it('hides Administração and skips the access query when unauthenticated', () => {
      renderLayout(buildAuthValue())
      expect(screen.queryByRole('link', { name: 'Administração' })).not.toBeInTheDocument()
      expect(fetchCurrentAccess).not.toHaveBeenCalled()
    })
  })
})
