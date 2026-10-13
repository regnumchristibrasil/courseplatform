import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCurrentAccess } from './features/authz/currentAccessApi'
import { getStaffCourse, listStaffCourses } from './features/admin/courses/api'
import { listAdminUsers } from './features/admin/users/api'
import { fetchMyCourses } from './features/studentArea/myCoursesApi'
import { queryClient } from './lib/queryClient'
import { App } from './App'

vi.mock('./lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('./features/analytics/PostHogProvider', () => ({ PostHogProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('./features/auth/AuthProvider', async () => {
  const { AuthContext: Ctx } = await import('./features/auth/AuthContext')
  const { buildAuth: build } = await import('./test/renderWithProviders')
  return { AuthProvider: ({ children }: { children: ReactNode }) => <Ctx.Provider value={build()}>{children}</Ctx.Provider> }
})
vi.mock('./features/authz/currentAccessApi', () => ({ fetchCurrentAccess: vi.fn() }))
vi.mock('./features/studentArea/myCoursesApi', () => ({ fetchMyCourses: vi.fn() }))
vi.mock('./features/admin/courses/api', async (orig) => ({
  ...(await orig<typeof import('./features/admin/courses/api')>()),
  getStaffCourse: vi.fn(),
  listStaffCourses: vi.fn(),
}))
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
  queryClient.clear() // the mocked client is a singleton: drop cached roles/courses between tests
  vi.mocked(listAdminUsers).mockResolvedValue({ users: [], total: 0 })
  vi.mocked(listStaffCourses).mockResolvedValue([])
})

describe('App student area routes', () => {
  it('renders Meus cursos at /meus-cursos for an authenticated user', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'student', isActive: true })
    vi.mocked(fetchMyCourses).mockResolvedValue([])
    window.history.pushState({}, '', '/meus-cursos')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Meus cursos', level: 1 })).toBeInTheDocument()
  })
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

  it.each(['tutor', 'admin', 'superadmin'] as const)('renders the course list at /admin/courses for %s', async (role) => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role, isActive: true })
    window.history.pushState({}, '', '/admin/courses')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Cursos' })).toBeInTheDocument()
  })

  it.each(['tutor', 'admin', 'superadmin'] as const)('renders the course detail at /admin/courses/:id for %s', async (role) => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role, isActive: true })
    vi.mocked(getStaffCourse).mockResolvedValue({
      courseId: 'c1', title: 'Curso Detalhe', description: null, status: 'draft', priceCents: 1000, accessDurationDays: null,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', enrollmentCount: 0, pendingOrderCount: 0, modules: [],
    })
    window.history.pushState({}, '', '/admin/courses/c1')
    render(<App />)
    expect(await screen.findByRole('treeitem', { name: /Curso Detalhe/ })).toBeInTheDocument()
  })

  it('renders NotFound at /admin/courses/:id for students', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'student', isActive: true })
    window.history.pushState({}, '', '/admin/courses/c1')
    render(<App />)
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument()
    expect(getStaffCourse).not.toHaveBeenCalled()
  })

  it('renders NotFound at /admin/courses for students', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'student', isActive: true })
    window.history.pushState({}, '', '/admin/courses')
    render(<App />)
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument()
  })

  it('keeps /admin/users closed to tutors', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'tutor', isActive: true })
    window.history.pushState({}, '', '/admin/users')
    render(<App />)
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument()
  })
})
