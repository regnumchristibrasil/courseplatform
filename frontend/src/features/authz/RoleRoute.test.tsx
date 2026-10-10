import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthContext'
import { buildAuth, buildSession, buildUser } from '../../test/renderWithProviders'
import { AdminUsersApiError } from '../admin/users/api'
import { fetchCurrentAccess } from './currentAccessApi'
import { isCourseStaffRole } from './coursePermissions'
import { RoleRoute } from './RoleRoute'

vi.mock('./currentAccessApi', () => ({ fetchCurrentAccess: vi.fn() }))

const AUTHED: AuthContextValue = buildAuth({
  session: buildSession(buildUser('u1')),
  user: buildUser('u1'),
})

function renderRoute(auth: AuthContextValue = AUTHED) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const result = render(
    <AuthContext.Provider value={auth}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/login" element={<p>Login page</p>} />
            <Route element={<RoleRoute />}>
              <Route path="/admin" element={<p>Admin content</p>} />
            </Route>
            <Route path="*" element={<p>Fallback</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  )
  return { ...result, queryClient, invalidate }
}

describe('RoleRoute with a custom role predicate', () => {
  function renderCourseRoute() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <AuthContext.Provider value={AUTHED}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/courses']}>
            <Routes>
              <Route element={<RoleRoute allowed={isCourseStaffRole} />}>
                <Route path="/courses" element={<p>Courses content</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>,
    )
  }

  it.each(['tutor', 'admin', 'superadmin'] as const)('renders content for active %s', async (role) => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role, isActive: true })
    renderCourseRoute()
    expect(await screen.findByText('Courses content')).toBeInTheDocument()
  })

  it('renders NotFound for students and inactive tutors', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'student', isActive: true })
    const first = renderCourseRoute()
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument()
    first.unmount()
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'tutor', isActive: false })
    renderCourseRoute()
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument()
  })
})

describe('RoleRoute', () => {
  beforeEach(() => {
    vi.mocked(AUTHED.signOut).mockClear()
  })

  it('shows a spinner while access is loading', () => {
    vi.mocked(fetchCurrentAccess).mockReturnValue(new Promise(() => {}))
    renderRoute()

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument()
  })

  it.each(['admin', 'superadmin'] as const)('renders content for active %s', async (role) => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role, isActive: true })
    renderRoute()

    expect(await screen.findByText('Admin content')).toBeInTheDocument()
  })

  it.each(['student', 'tutor'] as const)('renders NotFound for %s', async (role) => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role, isActive: true })
    renderRoute()

    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument()
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument()
  })

  it('renders NotFound for an inactive admin', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'admin', isActive: false })
    renderRoute()

    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument()
  })

  it('fails closed on a fetch error: alert with retry, never the content and not a 404', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetchCurrentAccess).mockRejectedValue(new Error('boom'))
    renderRoute()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument()
    expect(screen.queryByText('Página não encontrada')).not.toBeInTheDocument()
  })

  it('signs out exactly once on a 401 and never renders staff content', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetchCurrentAccess).mockRejectedValue(
      new AdminUsersApiError('unauthorized', 'Sua sessão expirou. Entre novamente.'),
    )
    renderRoute()

    await waitFor(() => expect(AUTHED.signOut).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(AUTHED.signOut).toHaveBeenCalledTimes(1)
  })

  it('does not sign out on a forbidden (403) error and keeps the retry alert', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetchCurrentAccess).mockRejectedValue(new AdminUsersApiError('forbidden', 'nope'))
    renderRoute()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(AUTHED.signOut).not.toHaveBeenCalled()
  })

  it('retry refetches and renders the content once access loads', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetchCurrentAccess)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ role: 'admin', isActive: true })
    renderRoute()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Tentar novamente' }))

    expect(await screen.findByText('Admin content')).toBeInTheDocument()
  })

  it('revalidates ["me"] when entering the admin area', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'admin', isActive: true })
    const { invalidate } = renderRoute()
    await screen.findByText('Admin content')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] })
  })

  it('redirects anonymous users to /login via ProtectedRoute', () => {
    renderRoute({ ...AUTHED, session: null, user: null })

    expect(screen.getByText('Login page')).toBeInTheDocument()
  })
})
