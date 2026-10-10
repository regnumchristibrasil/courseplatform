import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseListRow } from '../../../contracts/adminCourses'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { AdminCoursesApiError, listStaffCourses } from './api'
import AdminCoursesPage from './AdminCoursesPage'

vi.mock('../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), listStaffCourses: vi.fn() }))

function course(overrides: Partial<CourseListRow> = {}): CourseListRow {
  return {
    courseId: 'c1',
    title: 'Curso A',
    status: 'published',
    priceCents: 19900,
    accessDurationDays: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    enrollmentCount: 3,
    pendingOrderCount: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('AdminCoursesPage', () => {
  it('shows a spinner while loading', () => {
    vi.mocked(listStaffCourses).mockReturnValue(new Promise(() => {}))
    renderWithProviders(<AdminCoursesPage />)
    expect(screen.getByRole('status', { name: 'Carregando cursos...' })).toBeInTheDocument()
  })

  it('renders every course with status, price, access, and counts', async () => {
    vi.mocked(listStaffCourses).mockResolvedValue([
      course(),
      course({ courseId: 'c2', title: 'Curso B', status: 'draft', priceCents: 5000, accessDurationDays: 90, enrollmentCount: 0, pendingOrderCount: 0 }),
      course({ courseId: 'c3', title: 'Curso C', status: 'archived' }),
    ])
    renderWithProviders(<AdminCoursesPage />)

    const rowA = await screen.findByRole('row', { name: /Curso A/ })
    expect(rowA).toHaveTextContent('Publicado')
    expect(rowA).toHaveTextContent('R$ 199,00')
    expect(rowA).toHaveTextContent('Vitalício')
    const rowB = screen.getByRole('row', { name: /Curso B/ })
    expect(rowB).toHaveTextContent('Rascunho')
    expect(rowB).toHaveTextContent('90 dias')
    expect(screen.getByRole('row', { name: /Curso C/ })).toHaveTextContent('Arquivado')
    expect(screen.getByText('3 curso(s)')).toBeInTheDocument()
  })

  it('links each course title to its detail page', async () => {
    vi.mocked(listStaffCourses).mockResolvedValue([course({ courseId: 'c9', title: 'Curso Z' })])

    renderWithProviders(<AdminCoursesPage />)

    expect(await screen.findByRole('link', { name: 'Curso Z' })).toHaveAttribute('href', '/admin/courses/c9')
  })

  it('shows an empty state when there are no courses', async () => {
    vi.mocked(listStaffCourses).mockResolvedValue([])
    renderWithProviders(<AdminCoursesPage />)
    expect(await screen.findByText('Nenhum curso cadastrado.')).toBeInTheDocument()
  })

  it('shows a forbidden message when the server denies access', async () => {
    vi.mocked(listStaffCourses).mockRejectedValue(new AdminCoursesApiError('forbidden', 'forbidden'))
    renderWithProviders(<AdminCoursesPage />)
    expect(await screen.findByText('Você não tem permissão para acessar os cursos.')).toBeInTheDocument()
  })

  it('shows a generic error with retry that refetches', async () => {
    vi.mocked(listStaffCourses).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(listStaffCourses).mockResolvedValueOnce([course()])
    renderWithProviders(<AdminCoursesPage />)

    expect(await screen.findByText('Não foi possível carregar os cursos. Tente novamente.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByRole('row', { name: /Curso A/ })).toBeInTheDocument()
  })

  it('signs the user out when the session expired', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(listStaffCourses).mockRejectedValue(new AdminCoursesApiError('unauthorized', 'expired'))
    renderWithProviders(<AdminCoursesPage />, { auth: { signOut } })
    await screen.findByText('Sua sessão expirou. Entre novamente.')
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
