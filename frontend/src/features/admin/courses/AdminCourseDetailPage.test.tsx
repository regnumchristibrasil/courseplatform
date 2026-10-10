import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseTree } from '../../../contracts/adminCourses'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { AdminCoursesApiError, getStaffCourse } from './api'
import AdminCourseDetailPage from './AdminCourseDetailPage'

vi.mock('../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), getStaffCourse: vi.fn() }))

const TREE: CourseTree = {
  courseId: 'c1',
  title: 'Curso A',
  description: 'Descricao do curso',
  status: 'draft',
  priceCents: 19900,
  accessDurationDays: null,
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-02T10:00:00Z',
  enrollmentCount: 0,
  pendingOrderCount: 0,
  modules: [
    {
      moduleId: 'm1',
      title: 'Modulo 1',
      position: 1,
      archivedAt: null,
      lessons: [
        { lessonId: 'l1', title: 'Aula 1', position: 1, durationSeconds: 600, isFreePreview: false, archivedAt: null, video: { provider: 'youtube', externalRef: 'dQw4w9WgXcQ' } },
      ],
    },
  ],
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/courses/:courseId" element={<AdminCourseDetailPage />} />
    </Routes>,
    { route: '/admin/courses/c1' },
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('AdminCourseDetailPage', () => {
  it('shows a spinner while loading', () => {
    vi.mocked(getStaffCourse).mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByRole('status', { name: 'Carregando curso...' })).toBeInTheDocument()
  })

  it('requests the course from the route param', async () => {
    vi.mocked(getStaffCourse).mockResolvedValue(TREE)

    renderPage()

    await screen.findByRole('tree')
    expect(getStaffCourse).toHaveBeenCalledWith({ __fake: true }, 'c1')
  })

  it('renders the tree with the course selected and its details', async () => {
    vi.mocked(getStaffCourse).mockResolvedValue(TREE)

    renderPage()

    const course = await screen.findByRole('treeitem', { name: /Curso A/ })
    expect(course).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('region', { name: 'Detalhes do item selecionado' })
    expect(within(panel).getByRole('heading', { name: 'Curso A' })).toBeInTheDocument()
    expect(panel).toHaveTextContent('Descricao do curso')
  })

  it('shows the selected lesson and its video in the panel', async () => {
    vi.mocked(getStaffCourse).mockResolvedValue(TREE)
    renderPage()

    await userEvent.setup().click(await screen.findByRole('treeitem', { name: /Aula 1/ }))

    expect(screen.getByRole('treeitem', { name: /Aula 1/ })).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('region', { name: 'Detalhes do item selecionado' })
    expect(within(panel).getByRole('heading', { name: 'Aula 1' })).toBeInTheDocument()
    expect(panel).toHaveTextContent('dQw4w9WgXcQ')
  })

  it('shows the selected module in the panel via keyboard', async () => {
    vi.mocked(getStaffCourse).mockResolvedValue(TREE)
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('tree')
    await user.tab() // back link
    await user.tab() // tree (single tab stop)
    await user.keyboard('{ArrowDown}{Enter}')

    const panel = screen.getByRole('region', { name: 'Detalhes do item selecionado' })
    expect(within(panel).getByRole('heading', { name: 'Modulo 1' })).toBeInTheDocument()
  })

  it('links back to the course list', async () => {
    vi.mocked(getStaffCourse).mockResolvedValue(TREE)
    renderPage()

    expect(await screen.findByRole('link', { name: 'Voltar para cursos' })).toHaveAttribute('href', '/admin/courses')
  })

  it('shows a not found message', async () => {
    vi.mocked(getStaffCourse).mockRejectedValue(new AdminCoursesApiError('not_found', 'not_found'))

    renderPage()

    expect(await screen.findByText('Curso não encontrado.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voltar para cursos' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument()
  })

  it('shows a forbidden message', async () => {
    vi.mocked(getStaffCourse).mockRejectedValue(new AdminCoursesApiError('forbidden', 'forbidden'))

    renderPage()

    expect(await screen.findByText('Você não tem permissão para acessar este curso.')).toBeInTheDocument()
  })

  it('shows a generic error with retry that refetches', async () => {
    vi.mocked(getStaffCourse).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(getStaffCourse).mockResolvedValueOnce(TREE)
    renderPage()

    expect(await screen.findByText('Não foi possível carregar o curso. Tente novamente.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByRole('tree')).toBeInTheDocument()
  })

  it('signs the user out when the session expired', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(getStaffCourse).mockRejectedValue(new AdminCoursesApiError('unauthorized', 'expired'))
    renderWithProviders(
      <Routes>
        <Route path="/admin/courses/:courseId" element={<AdminCourseDetailPage />} />
      </Routes>,
      { route: '/admin/courses/c1', auth: { signOut } },
    )

    await screen.findByText('Sua sessão expirou. Entre novamente.')
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
