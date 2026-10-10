import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseTree, ModuleNode } from '../../../contracts/adminCourses'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { useCurrentAccess } from '../../authz/useCurrentAccess'
import { addModule, AdminCoursesApiError, deleteModule, getStaffCourse, renameModule, reorderModules, setModuleArchived } from './api'
import AdminCourseDetailPage from './AdminCourseDetailPage'

vi.mock('../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('../../authz/useCurrentAccess', () => ({ useCurrentAccess: vi.fn() }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getStaffCourse: vi.fn(),
  addModule: vi.fn(),
  renameModule: vi.fn(),
  reorderModules: vi.fn(),
  setModuleArchived: vi.fn(),
  deleteModule: vi.fn(),
}))

const CLIENT = { __fake: true }

function mod(id: string, position: number, overrides: Partial<ModuleNode> = {}): ModuleNode {
  return { moduleId: id, title: `Modulo ${id}`, position, archivedAt: null, lessons: [], ...overrides }
}

function treeWith(modules: readonly ModuleNode[]): CourseTree {
  return {
    courseId: 'c1',
    title: 'Curso A',
    description: null,
    status: 'draft',
    priceCents: 19900,
    accessDurationDays: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-02T10:00:00Z',
    enrollmentCount: 0,
    pendingOrderCount: 0,
    modules,
  }
}

const THREE = treeWith([mod('m1', 1), mod('m2', 2), mod('m3', 3)])

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/courses/:courseId" element={<AdminCourseDetailPage />} />
    </Routes>,
    { route: '/admin/courses/c1' },
  )
}

function asRole(role: 'admin' | 'tutor' | 'student') {
  vi.mocked(useCurrentAccess).mockReturnValue({ data: { role, isActive: true } } as ReturnType<typeof useCurrentAccess>)
}

async function selectModule(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(await screen.findByRole('treeitem', { name: new RegExp(`Modulo ${id}`) }))
  return screen.getByRole('region', { name: 'Ações do módulo' })
}

beforeEach(() => {
  vi.resetAllMocks()
  asRole('admin')
  vi.mocked(getStaffCourse).mockResolvedValue(THREE)
})

describe('adding a module', () => {
  it('adds a module from the course panel and re-reads the tree', async () => {
    vi.mocked(addModule).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Adicionar módulo' }))
    await user.type(screen.getByLabelText('Título do módulo'), '  Novo modulo ')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(addModule).toHaveBeenCalledWith(CLIENT, 'c1', 'Novo modulo')
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
    expect(screen.queryByLabelText('Título do módulo')).not.toBeInTheDocument()
  })

  it('rejects a blank title without calling the server', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Adicionar módulo' }))
    await user.type(screen.getByLabelText('Título do módulo'), '   ')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(await screen.findByText('Informe o título do módulo.')).toBeInTheDocument()
    expect(addModule).not.toHaveBeenCalled()
  })

  it('shows the server error and keeps the form open', async () => {
    vi.mocked(addModule).mockRejectedValue(new AdminCoursesApiError('forbidden', 'forbidden'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Adicionar módulo' }))
    await user.type(screen.getByLabelText('Título do módulo'), 'X')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(await screen.findByText('Você não tem permissão para esta alteração.')).toBeInTheDocument()
    expect(screen.getByLabelText('Título do módulo')).toBeInTheDocument()
  })

  it('is available to tutors', async () => {
    asRole('tutor')
    renderPage()

    expect(await screen.findByRole('button', { name: 'Adicionar módulo' })).toBeInTheDocument()
  })

  it('is hidden from non-staff roles', async () => {
    asRole('student')
    renderPage()

    await screen.findByRole('tree')
    expect(screen.queryByRole('button', { name: 'Adicionar módulo' })).not.toBeInTheDocument()
  })
})

describe('renaming a module', () => {
  it('prefills the title and saves the new one', async () => {
    vi.mocked(renameModule).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm2')
    await user.click(within(panel).getByRole('button', { name: 'Renomear' }))
    const input = screen.getByLabelText('Título do módulo')
    expect(input).toHaveValue('Modulo m2')
    await user.clear(input)
    await user.type(input, 'Outro nome')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(renameModule).toHaveBeenCalledWith(CLIENT, 'm2', 'Outro nome')
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
  })

  it('cancels without calling the server', async () => {
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm2')
    await user.click(within(panel).getByRole('button', { name: 'Renomear' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByLabelText('Título do módulo')).not.toBeInTheDocument()
    expect(renameModule).not.toHaveBeenCalled()
  })
})

describe('reordering modules', () => {
  it('moves a module up by sending the full ordered list', async () => {
    vi.mocked(reorderModules).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm2')
    await user.click(within(panel).getByRole('button', { name: 'Mover para cima' }))

    expect(reorderModules).toHaveBeenCalledWith(CLIENT, 'c1', ['m2', 'm1', 'm3'])
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
  })

  it('moves a module down', async () => {
    vi.mocked(reorderModules).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm2')
    await user.click(within(panel).getByRole('button', { name: 'Mover para baixo' }))

    expect(reorderModules).toHaveBeenCalledWith(CLIENT, 'c1', ['m1', 'm3', 'm2'])
  })

  it('disables the move that is impossible at the edges', async () => {
    const user = userEvent.setup()
    renderPage()

    const first = await selectModule(user, 'm1')
    expect(within(first).getByRole('button', { name: 'Mover para cima' })).toBeDisabled()
    const last = await selectModule(user, 'm3')
    expect(within(last).getByRole('button', { name: 'Mover para baixo' })).toBeDisabled()
  })

  it('explains a stale list and re-reads the tree', async () => {
    vi.mocked(reorderModules).mockRejectedValue(new AdminCoursesApiError('stale_target', 'stale_target'))
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm2')
    await user.click(within(panel).getByRole('button', { name: 'Mover para cima' }))

    expect(await screen.findByText(/estrutura do curso foi alterada por outra pessoa/)).toBeInTheDocument()
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
  })
})

describe('archiving a module', () => {
  it('archives without a confirmation step', async () => {
    vi.mocked(setModuleArchived).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm2')
    await user.click(within(panel).getByRole('button', { name: 'Arquivar' }))

    expect(setModuleArchived).toHaveBeenCalledWith(CLIENT, 'm2', true)
  })

  it('offers to unarchive an archived module', async () => {
    vi.mocked(getStaffCourse).mockResolvedValue(treeWith([mod('m1', 1, { archivedAt: '2026-02-01T00:00:00Z' })]))
    vi.mocked(setModuleArchived).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm1')
    expect(within(panel).queryByRole('button', { name: 'Arquivar' })).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Desarquivar' }))

    expect(setModuleArchived).toHaveBeenCalledWith(CLIENT, 'm1', false)
  })
})

describe('deleting a module', () => {
  it('asks for confirmation and deletes only after confirming', async () => {
    vi.mocked(deleteModule).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm2')
    await user.click(within(panel).getByRole('button', { name: 'Excluir' }))
    const dialog = screen.getByRole('dialog', { name: 'Excluir módulo' })
    expect(deleteModule).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('Modulo m2')
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }))

    expect(deleteModule).toHaveBeenCalledWith(CLIENT, 'm2')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(getStaffCourse).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm2')
    await user.click(within(panel).getByRole('button', { name: 'Excluir' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

    expect(deleteModule).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('explains that a non-empty module cannot be deleted', async () => {
    vi.mocked(deleteModule).mockRejectedValue(new AdminCoursesApiError('module_not_empty', 'module_not_empty'))
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm2')
    await user.click(within(panel).getByRole('button', { name: 'Excluir' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }))

    expect(await screen.findByText(/ainda tem aulas/)).toBeInTheDocument()
  })

  it('explains that a course with sales only archives', async () => {
    vi.mocked(deleteModule).mockRejectedValue(new AdminCoursesApiError('course_has_sales', 'course_has_sales'))
    const user = userEvent.setup()
    renderPage()

    const panel = await selectModule(user, 'm2')
    await user.click(within(panel).getByRole('button', { name: 'Excluir' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }))

    expect(await screen.findByText(/matrículas ou pedidos/)).toBeInTheDocument()
  })
})
