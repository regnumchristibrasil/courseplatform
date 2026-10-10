import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseTree, LessonNode, ModuleNode } from '../../../contracts/adminCourses'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { useCurrentAccess } from '../../authz/useCurrentAccess'
import {
  addLesson,
  AdminCoursesApiError,
  deleteLesson,
  getStaffCourse,
  moveLesson,
  reorderLessons,
  setLessonArchived,
  updateLesson,
} from './api'
import AdminCourseDetailPage from './AdminCourseDetailPage'

vi.mock('../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('../../authz/useCurrentAccess', () => ({ useCurrentAccess: vi.fn() }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getStaffCourse: vi.fn(),
  addLesson: vi.fn(),
  updateLesson: vi.fn(),
  reorderLessons: vi.fn(),
  moveLesson: vi.fn(),
  setLessonArchived: vi.fn(),
  deleteLesson: vi.fn(),
}))

const CLIENT = { __fake: true }
const TOKEN_1 = '2026-01-03T10:00:00.123456+00:00'
const TOKEN_2 = '2026-01-04T10:00:00.5+00:00'

function lesson(id: string, position: number, overrides: Partial<LessonNode> = {}): LessonNode {
  return {
    lessonId: id,
    title: `Aula ${id}`,
    position,
    durationSeconds: 90,
    isFreePreview: false,
    archivedAt: null,
    updatedAt: id === 'l1' ? TOKEN_1 : TOKEN_2,
    video: { provider: 'youtube', externalRef: 'abc' },
    ...overrides,
  }
}

const M1: ModuleNode = {
  moduleId: 'm1',
  title: 'Modulo m1',
  position: 1,
  archivedAt: null,
  lessons: [lesson('l1', 1), lesson('l2', 2, { archivedAt: '2026-02-01T00:00:00Z', video: null })],
}
const M2: ModuleNode = { moduleId: 'm2', title: 'Modulo m2', position: 2, archivedAt: null, lessons: [] }

function treeWith(modules: readonly ModuleNode[], status: CourseTree['status'] = 'draft'): CourseTree {
  return {
    courseId: 'c1',
    title: 'Curso A',
    description: null,
    status,
    priceCents: 19900,
    accessDurationDays: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-02T10:00:00Z',
    enrollmentCount: 0,
    pendingOrderCount: 0,
    modules,
  }
}

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

async function selectLesson(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(await screen.findByRole('treeitem', { name: new RegExp(`Aula ${id}`) }))
  return screen.getByRole('region', { name: 'Ações da aula' })
}

beforeEach(() => {
  vi.resetAllMocks()
  asRole('admin')
  vi.mocked(getStaffCourse).mockResolvedValue(treeWith([M1, M2]))
})

describe('adding a lesson', () => {
  it('adds a lesson from the module panel and re-reads the tree', async () => {
    vi.mocked(addLesson).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('treeitem', { name: /Modulo m1/ }))
    await user.click(screen.getByRole('button', { name: 'Adicionar aula' }))
    await user.type(screen.getByLabelText('Título da aula'), '  Nova aula ')
    await user.type(screen.getByLabelText('Duração (segundos)'), '120')
    await user.click(screen.getByLabelText('Prévia gratuita'))
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(addLesson).toHaveBeenCalledWith(CLIENT, 'm1', { title: 'Nova aula', durationSeconds: 120, isFreePreview: true }, false)
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
  })

  it('sends a null duration when the field is blank', async () => {
    vi.mocked(addLesson).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('treeitem', { name: /Modulo m1/ }))
    await user.click(screen.getByRole('button', { name: 'Adicionar aula' }))
    await user.type(screen.getByLabelText('Título da aula'), 'Sem duração')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(addLesson).toHaveBeenCalledWith(CLIENT, 'm1', { title: 'Sem duração', durationSeconds: null, isFreePreview: false }, false)
  })

  it('rejects a blank title and an invalid duration without calling the server', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('treeitem', { name: /Modulo m1/ }))
    await user.click(screen.getByRole('button', { name: 'Adicionar aula' }))
    await user.type(screen.getByLabelText('Duração (segundos)'), '0')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(await screen.findByText('Informe o título da aula.')).toBeInTheDocument()
    expect(screen.getByText('A duração deve ser um número inteiro de segundos entre 1 e 86400.')).toBeInTheDocument()
    expect(addLesson).not.toHaveBeenCalled()
  })

  it('on a published course the lesson is created archived by default', async () => {
    vi.mocked(getStaffCourse).mockResolvedValue(treeWith([M1, M2], 'published'))
    vi.mocked(addLesson).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('treeitem', { name: /Modulo m1/ }))
    await user.click(screen.getByRole('button', { name: 'Adicionar aula' }))
    const archived = screen.getByLabelText(/Criar arquivada/)
    expect(archived).toBeChecked()
    await user.type(screen.getByLabelText('Título da aula'), 'Rascunho')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(addLesson).toHaveBeenCalledWith(CLIENT, 'm1', { title: 'Rascunho', durationSeconds: null, isFreePreview: false }, true)
  })

  it('explains the publish gate when an active lesson is rejected', async () => {
    vi.mocked(getStaffCourse).mockResolvedValue(treeWith([M1, M2], 'published'))
    vi.mocked(addLesson).mockRejectedValue(new AdminCoursesApiError('publish_gate_violated', 'publish_gate_violated'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('treeitem', { name: /Modulo m1/ }))
    await user.click(screen.getByRole('button', { name: 'Adicionar aula' }))
    await user.click(screen.getByLabelText(/Criar arquivada/))
    await user.type(screen.getByLabelText('Título da aula'), 'Ativa')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(await screen.findByText(/precisa de um vídeo/)).toBeInTheDocument()
    expect(screen.getByLabelText('Título da aula')).toBeInTheDocument()
  })
})

describe('editing a lesson', () => {
  it('saves title, duration and preview flag with the updated_at token as read', async () => {
    vi.mocked(updateLesson).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Título da aula')).toHaveValue('Aula l1')
    expect(screen.getByLabelText('Duração (segundos)')).toHaveValue('90')
    await user.clear(screen.getByLabelText('Título da aula'))
    await user.type(screen.getByLabelText('Título da aula'), '  Renomeada ')
    await user.clear(screen.getByLabelText('Duração (segundos)'))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(updateLesson).toHaveBeenCalledWith(CLIENT, 'l1', TOKEN_1, { title: 'Renomeada', durationSeconds: null, isFreePreview: false })
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
  })

  it('tells the user to review after a conflict and re-reads the tree', async () => {
    vi.mocked(updateLesson).mockRejectedValue(new AdminCoursesApiError('stale_target', 'stale_target'))
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText(/alterada por outra pessoa/)).toBeInTheDocument()
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
  })
})

describe('reordering and moving', () => {
  it('moves a lesson down by sending the full list, archived included', async () => {
    vi.mocked(reorderLessons).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Mover para baixo' }))

    expect(reorderLessons).toHaveBeenCalledWith(CLIENT, 'm1', ['l2', 'l1'])
  })

  it('disables moving up for the first lesson', async () => {
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    expect(screen.getByRole('button', { name: 'Mover para cima' })).toBeDisabled()
  })

  it('moves the lesson to another module of the course', async () => {
    vi.mocked(moveLesson).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.selectOptions(screen.getByLabelText('Mover para o módulo'), 'm2')
    await user.click(screen.getByRole('button', { name: 'Mover para o módulo selecionado' }))

    expect(moveLesson).toHaveBeenCalledWith(CLIENT, 'l1', TOKEN_1, 'm2')
  })

  it('offers no target module when the course has a single module', async () => {
    vi.mocked(getStaffCourse).mockResolvedValue(treeWith([M1]))
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    expect(screen.queryByLabelText('Mover para o módulo')).not.toBeInTheDocument()
  })
})

describe('archiving and deleting', () => {
  it('archives an active lesson', async () => {
    vi.mocked(setLessonArchived).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Arquivar' }))

    expect(setLessonArchived).toHaveBeenCalledWith(CLIENT, 'l1', TOKEN_1, true)
  })

  it('unarchives an archived lesson and explains the publish gate on rejection', async () => {
    vi.mocked(setLessonArchived).mockRejectedValue(new AdminCoursesApiError('publish_gate_violated', 'publish_gate_violated'))
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l2')
    await user.click(screen.getByRole('button', { name: 'Desarquivar' }))

    expect(setLessonArchived).toHaveBeenCalledWith(CLIENT, 'l2', TOKEN_2, false)
    expect(await screen.findByText(/precisa de um vídeo/)).toBeInTheDocument()
  })

  it('deletes only after confirmation', async () => {
    vi.mocked(deleteLesson).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(deleteLesson).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }))

    expect(deleteLesson).toHaveBeenCalledWith(CLIENT, 'l1', TOKEN_1)
  })

  it('suggests archiving when the course has sales', async () => {
    vi.mocked(deleteLesson).mockRejectedValue(new AdminCoursesApiError('course_has_sales', 'course_has_sales'))
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Excluir' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }))

    expect(await within(dialog).findByText(/só podem ser arquivadas/)).toBeInTheDocument()
  })
})

describe('permissions', () => {
  it('shows no lesson actions to a non-staff role', async () => {
    asRole('student')
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('treeitem', { name: /Aula l1/ }))
    expect(screen.queryByRole('region', { name: 'Ações da aula' })).not.toBeInTheDocument()
  })

  it('lets a tutor manage lessons', async () => {
    asRole('tutor')
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })
})
