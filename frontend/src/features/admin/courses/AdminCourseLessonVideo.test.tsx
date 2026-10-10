import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseTree, LessonNode, ModuleNode } from '../../../contracts/adminCourses'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { useCurrentAccess } from '../../authz/useCurrentAccess'
import { AdminCoursesApiError, getStaffCourse, setLessonVideo } from './api'
import AdminCourseDetailPage from './AdminCourseDetailPage'

vi.mock('../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('../../authz/useCurrentAccess', () => ({ useCurrentAccess: vi.fn() }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getStaffCourse: vi.fn(),
  setLessonVideo: vi.fn(),
}))

const CLIENT = { __fake: true }
const TOKEN_1 = '2026-01-03T10:00:00.123456+00:00'
const TOKEN_2 = '2026-01-04T10:00:00.5+00:00'
const YT_URL = 'https://youtu.be/dQw4w9WgXcQ?si=abc'
const PANDA_UUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

function lesson(id: string, overrides: Partial<LessonNode> = {}): LessonNode {
  return {
    lessonId: id,
    title: `Aula ${id}`,
    position: id === 'l1' ? 1 : 2,
    durationSeconds: 90,
    isFreePreview: false,
    archivedAt: null,
    updatedAt: id === 'l1' ? TOKEN_1 : TOKEN_2,
    video: { provider: 'youtube', externalRef: 'abcdefghijk' },
    ...overrides,
  }
}

const M1: ModuleNode = {
  moduleId: 'm1',
  title: 'Modulo m1',
  position: 1,
  archivedAt: null,
  lessons: [lesson('l1'), lesson('l2', { archivedAt: '2026-02-01T00:00:00Z', video: null })],
}

const TREE: CourseTree = {
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
  modules: [M1],
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
  return screen.getByRole('region', { name: 'Vídeo da aula' })
}

beforeEach(() => {
  vi.resetAllMocks()
  asRole('admin')
  vi.mocked(getStaffCourse).mockResolvedValue(TREE)
})

describe('lesson video action', () => {
  it('offers "Substituir vídeo" when the lesson has a video and "Definir vídeo" when it has none', async () => {
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    expect(screen.getByRole('button', { name: 'Substituir vídeo' })).toBeInTheDocument()
    await selectLesson(user, 'l2')
    expect(screen.getByRole('button', { name: 'Definir vídeo' })).toBeInTheDocument()
  })

  it('sends the pasted URL with the lesson token and re-reads the tree', async () => {
    vi.mocked(setLessonVideo).mockResolvedValue({ provider: 'youtube', externalRef: 'dQw4w9WgXcQ', duplicates: [] })
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Substituir vídeo' }))
    await user.type(screen.getByLabelText('ID ou URL do vídeo'), YT_URL)
    await user.click(screen.getByRole('button', { name: 'Salvar vídeo' }))

    expect(setLessonVideo).toHaveBeenCalledWith(CLIENT, 'l1', TOKEN_1, YT_URL)
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Vídeo salvo/)).toBeInTheDocument()
    expect(screen.queryByLabelText('ID ou URL do vídeo')).not.toBeInTheDocument()
  })

  it('previews the normalized reference as the user types', async () => {
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Substituir vídeo' }))
    await user.type(screen.getByLabelText('ID ou URL do vídeo'), YT_URL)
    expect(screen.getByText('Será salvo como YouTube: dQw4w9WgXcQ')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('ID ou URL do vídeo'))
    await user.type(screen.getByLabelText('ID ou URL do vídeo'), PANDA_UUID.toUpperCase())
    expect(screen.getByText(`Será salvo como Panda Video: ${PANDA_UUID}`)).toBeInTheDocument()
  })

  it('rejects an unrecognized format without calling the server', async () => {
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Substituir vídeo' }))
    await user.type(screen.getByLabelText('ID ou URL do vídeo'), 'isto nao e um video')
    await user.click(screen.getByRole('button', { name: 'Salvar vídeo' }))

    expect(await screen.findByText(/Formato não reconhecido/)).toBeInTheDocument()
    expect(setLessonVideo).not.toHaveBeenCalled()
  })

  it('rejects blank input', async () => {
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Substituir vídeo' }))
    await user.click(screen.getByRole('button', { name: 'Salvar vídeo' }))

    expect(await screen.findByText('Informe o ID ou a URL do vídeo.')).toBeInTheDocument()
    expect(setLessonVideo).not.toHaveBeenCalled()
  })

  it('warns, listing the other course and lesson titles, when the video is already used elsewhere', async () => {
    vi.mocked(setLessonVideo).mockResolvedValue({
      provider: 'youtube',
      externalRef: 'dQw4w9WgXcQ',
      duplicates: [
        { courseTitle: 'Curso B', lessonTitle: 'Aula 3' },
        { courseTitle: 'Curso A', lessonTitle: 'Aula 9' },
      ],
    })
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l2')
    await user.click(screen.getByRole('button', { name: 'Definir vídeo' }))
    await user.type(screen.getByLabelText('ID ou URL do vídeo'), 'dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: 'Salvar vídeo' }))

    const warning = await screen.findByRole('alert')
    expect(warning).toHaveTextContent('Este vídeo também é usado em outras aulas')
    expect(warning).toHaveTextContent('Curso B / Aula 3')
    expect(warning).toHaveTextContent('Curso A / Aula 9')
  })

  it('shows a conflict message and re-reads the tree on stale_target, keeping the typed text', async () => {
    vi.mocked(setLessonVideo).mockRejectedValue(new AdminCoursesApiError('stale_target', 'stale_target'))
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Substituir vídeo' }))
    await user.type(screen.getByLabelText('ID ou URL do vídeo'), YT_URL)
    await user.click(screen.getByRole('button', { name: 'Salvar vídeo' }))

    expect(await screen.findByText(/foi alterada por outra pessoa/)).toBeInTheDocument()
    await vi.waitFor(() => expect(getStaffCourse).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('ID ou URL do vídeo')).toHaveValue(YT_URL)
  })

  it('cancel closes the form without calling the server', async () => {
    const user = userEvent.setup()
    renderPage()

    await selectLesson(user, 'l1')
    await user.click(screen.getByRole('button', { name: 'Substituir vídeo' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByLabelText('ID ou URL do vídeo')).not.toBeInTheDocument()
    expect(setLessonVideo).not.toHaveBeenCalled()
  })

  it('is available to tutors and hidden from students', async () => {
    asRole('tutor')
    const user = userEvent.setup()
    const { unmount } = renderPage()
    await selectLesson(user, 'l1')
    unmount()

    asRole('student')
    renderPage()
    await user.click(await screen.findByRole('treeitem', { name: /Aula l1/ }))
    expect(screen.queryByRole('region', { name: 'Vídeo da aula' })).not.toBeInTheDocument()
  })
})
