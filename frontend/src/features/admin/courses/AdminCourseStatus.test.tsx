import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseStatus, CourseTree } from '../../../contracts/adminCourses'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { useCurrentAccess } from '../../authz/useCurrentAccess'
import { AdminCoursesApiError, deleteCourse, getStaffCourse, setCourseStatus } from './api'
import AdminCourseDetailPage from './AdminCourseDetailPage'

vi.mock('../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('../../authz/useCurrentAccess', () => ({ useCurrentAccess: vi.fn() }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getStaffCourse: vi.fn(),
  setCourseStatus: vi.fn(),
  deleteCourse: vi.fn(),
}))

const CLIENT = { __fake: true }
const UPDATED_AT = '2026-01-02T10:00:00.123456+00:00'

function tree(status: CourseStatus, overrides: Partial<CourseTree> = {}): CourseTree {
  return {
    courseId: 'c1',
    title: 'Curso A',
    description: null,
    status,
    priceCents: 19900,
    accessDurationDays: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: UPDATED_AT,
    enrollmentCount: 0,
    pendingOrderCount: 0,
    modules: [
      {
        moduleId: 'm1',
        title: 'Modulo 1',
        position: 1,
        archivedAt: null,
        lessons: [
          { lessonId: 'l1', title: 'Introdução', position: 1, durationSeconds: null, isFreePreview: false, archivedAt: null, updatedAt: 't', video: null },
        ],
      },
    ],
    ...overrides,
  }
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/courses/:courseId" element={<AdminCourseDetailPage />} />
      <Route path="/admin/courses" element={<p>Lista de cursos</p>} />
    </Routes>,
    { route: '/admin/courses/c1' },
  )
}

function asRole(role: 'admin' | 'tutor' | 'student') {
  vi.mocked(useCurrentAccess).mockReturnValue({ data: { role, isActive: true } } as ReturnType<typeof useCurrentAccess>)
}

const panel = async () => screen.findByRole('region', { name: 'Status do curso' })

beforeEach(() => {
  vi.resetAllMocks()
  asRole('admin')
  vi.mocked(getStaffCourse).mockResolvedValue(tree('draft'))
})

describe('status buttons follow the allowed transitions', () => {
  it.each([
    ['draft', ['Publicar'], ['Voltar para rascunho', 'Arquivar']],
    ['published', ['Voltar para rascunho', 'Arquivar'], ['Publicar']],
    ['archived', ['Voltar para rascunho'], ['Publicar', 'Arquivar']],
  ] as const)('%s', async (status, present, absent) => {
    vi.mocked(getStaffCourse).mockResolvedValue(tree(status))
    renderPage()
    const region = await panel()
    for (const name of present) expect(within(region).getByRole('button', { name })).toBeEnabled()
    for (const name of absent) expect(within(region).queryByRole('button', { name })).not.toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Excluir curso' })).toBeInTheDocument()
  })

  it('is available to a tutor, who may change status and delete', async () => {
    asRole('tutor')
    renderPage()
    const region = await panel()
    expect(within(region).getByRole('button', { name: 'Publicar' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Excluir curso' })).toBeInTheDocument()
  })

  it('is hidden when the module or lesson is selected', async () => {
    const user = userEvent.setup()
    renderPage()
    await panel()
    await user.click(await screen.findByRole('treeitem', { name: /Modulo 1/ }))
    expect(screen.queryByRole('region', { name: 'Status do curso' })).not.toBeInTheDocument()
  })
})

describe('changing status', () => {
  it('sends the updated_at that was read and re-reads the tree', async () => {
    vi.mocked(setCourseStatus).mockResolvedValue({ courseId: 'c1', updatedAt: 'x' })
    vi.mocked(getStaffCourse).mockResolvedValue(tree('draft', { modules: [{ ...tree('draft').modules[0]!, lessons: [{ ...tree('draft').modules[0]!.lessons[0]!, video: { provider: 'youtube', externalRef: 'abcdefghijk' } }] }] }))
    const user = userEvent.setup()
    renderPage()
    await user.click(within(await panel()).getByRole('button', { name: 'Publicar' }))
    expect(setCourseStatus).toHaveBeenCalledWith(CLIENT, 'c1', UPDATED_AT, 'published')
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
  })

  it('lists the gate violations, naming the lessons, and keeps the status', async () => {
    vi.mocked(setCourseStatus).mockRejectedValue(
      new AdminCoursesApiError('publish_gate_violated', 'm', undefined, [
        { code: 'price_missing' },
        { code: 'lesson_without_video', lessonId: 'l1' },
      ]),
    )
    const user = userEvent.setup()
    renderPage()
    await user.click(within(await panel()).getByRole('button', { name: 'Publicar' }))
    const list = await screen.findByRole('list', { name: 'Pendências para publicar' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(/preço/i)
    expect(items[1]).toHaveTextContent('Introdução')
    expect(getStaffCourse).toHaveBeenCalledTimes(1)
  })

  it('falls back to a generic gate message when the list is empty', async () => {
    vi.mocked(setCourseStatus).mockRejectedValue(new AdminCoursesApiError('publish_gate_violated', 'm'))
    const user = userEvent.setup()
    renderPage()
    await user.click(within(await panel()).getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/não atende aos requisitos/i)
  })

  it('explains an invalid transition and re-reads the tree', async () => {
    vi.mocked(setCourseStatus).mockRejectedValue(new AdminCoursesApiError('invalid_transition', 'm'))
    const user = userEvent.setup()
    renderPage()
    await user.click(within(await panel()).getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/transição de status/i)
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
  })

  it('recovers from a stale edit by re-reading the tree', async () => {
    vi.mocked(setCourseStatus).mockRejectedValue(new AdminCoursesApiError('stale_target', 'm'))
    const user = userEvent.setup()
    renderPage()
    await user.click(within(await panel()).getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/alterado por outra pessoa/i)
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
  })
})

describe('deleting a course', () => {
  it('asks for confirmation, deletes and returns to the list', async () => {
    vi.mocked(deleteCourse).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()
    await user.click(within(await panel()).getByRole('button', { name: 'Excluir curso' }))
    const dialog = await screen.findByRole('dialog', { name: 'Excluir curso' })
    expect(deleteCourse).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }))
    expect(deleteCourse).toHaveBeenCalledWith(CLIENT, 'c1', UPDATED_AT)
    expect(await screen.findByText('Lista de cursos')).toBeInTheDocument()
  })

  it('cancel does not delete', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(within(await panel()).getByRole('button', { name: 'Excluir curso' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(deleteCourse).not.toHaveBeenCalled()
  })

  it('suggests archiving when the course has sales', async () => {
    vi.mocked(deleteCourse).mockRejectedValue(new AdminCoursesApiError('course_has_sales', 'm'))
    const user = userEvent.setup()
    renderPage()
    await user.click(within(await panel()).getByRole('button', { name: 'Excluir curso' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Excluir' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/arquive/i)
    expect(screen.queryByText('Lista de cursos')).not.toBeInTheDocument()
  })

  it('warns up front when sales are already visible in the counters', async () => {
    vi.mocked(getStaffCourse).mockResolvedValue(tree('published', { enrollmentCount: 2 }))
    const user = userEvent.setup()
    renderPage()
    await user.click(within(await panel()).getByRole('button', { name: 'Excluir curso' }))
    expect(within(await screen.findByRole('dialog')).getByText(/matrículas ou pedidos.*arquive/i)).toBeInTheDocument()
  })
})
