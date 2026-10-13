import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseTree } from '../../contracts/studentArea'
import { renderWithProviders } from '../../test/renderWithProviders'
import { listLessonComments } from './commentsApi'
import { setLessonCompleted } from './completionApi'
import { fetchCourseTree } from './courseTreeApi'
import { LessonPage } from './LessonPage'
import { fetchLessonVideo } from './lessonVideoApi'
import { startLesson } from './startLessonApi'

vi.mock('./commentsApi', () => ({ listLessonComments: vi.fn(), createLessonComment: vi.fn(), deleteLessonComment: vi.fn(), StudentAreaApiError: class extends Error {} }))
vi.mock('./completionApi', () => ({ setLessonCompleted: vi.fn() }))
vi.mock('./courseTreeApi', () => ({ fetchCourseTree: vi.fn() }))
vi.mock('./lessonVideoApi', () => ({ fetchLessonVideo: vi.fn() }))
vi.mock('./startLessonApi', () => ({ startLesson: vi.fn() }))

function tree(overrides: Partial<CourseTree> = {}): CourseTree {
  return {
    courseId: 'course-1',
    title: 'Introducao ao React',
    description: null,
    courseStatus: 'published',
    isStaff: false,
    totalLessons: 3,
    completedLessons: 0,
    progressPercent: 0,
    totalDurationSeconds: 0,
    continueLessonId: 'l1',
    modules: [
      {
        id: 'm1',
        title: 'Fundamentos',
        lessons: [
          { id: 'l1', title: 'Boas-vindas', durationSeconds: 300, state: 'completed' },
          { id: 'l2', title: 'JSX', durationSeconds: 600, state: 'not_started' },
        ],
      },
      { id: 'm2', title: 'Estado', lessons: [{ id: 'l3', title: 'useState', durationSeconds: null, state: 'not_started' }] },
    ],
    ...overrides,
  }
}

function renderPage(lessonId = 'l2') {
  return renderWithProviders(
    <Routes>
      <Route path="/meus-cursos/:courseId/aulas/:lessonId" element={<LessonPage />} />
    </Routes>,
    { route: `/meus-cursos/course-1/aulas/${lessonId}` },
  )
}

describe('LessonPage', () => {
  beforeEach(() => {
    vi.mocked(fetchCourseTree).mockReset().mockResolvedValue(tree())
    vi.mocked(fetchLessonVideo)
      .mockReset()
      .mockResolvedValue({ playerKind: 'youtube', videoId: 'abc', expiresAt: null })
    vi.mocked(listLessonComments).mockReset().mockResolvedValue({ threads: [], nextCursor: null })
    vi.mocked(startLesson).mockReset().mockResolvedValue(true)
    vi.mocked(setLessonCompleted).mockReset().mockResolvedValue(true)
  })

  it('renders without React key warnings', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      renderPage('l2')
      expect(await screen.findByRole('heading', { level: 1, name: 'JSX' })).toBeInTheDocument()
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('shows a loading state first', () => {
    vi.mocked(fetchCourseTree).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('status', { name: /carregando a aula/i })).toBeInTheDocument()
  })

  it('renders title, breadcrumb and the player', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'JSX' })).toBeInTheDocument()
    const crumbs = screen.getByRole('navigation', { name: /trilha/i })
    expect(within(crumbs).getByRole('link', { name: 'Introducao ao React' })).toHaveAttribute('href', '/meus-cursos/course-1')
    expect(within(crumbs).getByText('Fundamentos')).toBeInTheDocument()
    expect(await screen.findByTitle(/aula em vídeo/i)).toHaveAttribute('src', expect.stringContaining('abc'))
    expect(fetchLessonVideo).toHaveBeenCalledWith(expect.anything(), 'l2')
  })

  it('lists the lessons of the module with the current one marked', async () => {
    renderPage()
    const list = await screen.findByRole('navigation', { name: /aulas do módulo/i })
    expect(within(list).getByRole('link', { name: /boas-vindas/i })).toHaveAttribute('href', '/meus-cursos/course-1/aulas/l1')
    expect(within(list).getByRole('link', { name: /jsx/i })).toHaveAttribute('aria-current', 'page')
    expect(within(list).queryByText('useState')).not.toBeInTheDocument()
  })

  it('links to the previous and next lessons across modules', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /aula anterior/i })).toHaveAttribute('href', '/meus-cursos/course-1/aulas/l1')
    expect(screen.getByRole('link', { name: /próxima aula/i })).toHaveAttribute('href', '/meus-cursos/course-1/aulas/l3')
  })

  it('omits previous on the first lesson and next on the last', async () => {
    renderPage('l1')
    await screen.findByRole('heading', { level: 1, name: 'Boas-vindas' })
    expect(screen.queryByRole('link', { name: /aula anterior/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /próxima aula/i })).toBeInTheDocument()
  })

  it('registers the lesson as started when it is not started yet', async () => {
    renderPage('l2')
    await waitFor(() => expect(startLesson).toHaveBeenCalledWith(expect.anything(), 'l2'))
    expect(startLesson).toHaveBeenCalledTimes(1)
  })

  it('refreshes the course tree and my courses after registering', async () => {
    const { invalidate } = renderPage('l2')
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: readonly string[] }).queryKey.join('/'))
    expect(keys).toEqual(expect.arrayContaining(['student/course-tree', 'student/my-courses']))
  })

  it('does not call start for a lesson already in progress or completed', async () => {
    renderPage('l1')
    await screen.findByRole('heading', { level: 1, name: 'Boas-vindas' })
    expect(startLesson).not.toHaveBeenCalled()
  })

  it('does not call start for staff and hides state icons', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(tree({ isStaff: true }))
    renderPage('l2')
    await screen.findByRole('heading', { level: 1, name: 'JSX' })
    expect(startLesson).not.toHaveBeenCalled()
    expect(screen.queryByText('Concluída')).not.toBeInTheDocument()
  })

  it('shows an unavailable message when the video cannot be resolved', async () => {
    vi.mocked(fetchLessonVideo).mockResolvedValue(null)
    renderPage()
    expect(await screen.findByText(/vídeo indisponível/i)).toBeInTheDocument()
  })

  it('offers a retry when the video fails to load', async () => {
    vi.mocked(fetchLessonVideo).mockRejectedValueOnce(new Error('boom'))
    renderPage()
    expect(await screen.findByText(/não foi possível carregar o vídeo/i)).toBeInTheDocument()
  })

  it('renders not found when the tree is null (no access, preview only)', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(null)
    renderPage()
    expect(await screen.findByRole('heading', { name: /página não encontrada/i })).toBeInTheDocument()
    expect(fetchLessonVideo).not.toHaveBeenCalled()
  })

  it('renders not found when the lesson is not in the tree (archived or unknown)', async () => {
    renderPage('ghost')
    expect(await screen.findByRole('heading', { name: /página não encontrada/i })).toBeInTheDocument()
    expect(startLesson).not.toHaveBeenCalled()
  })

  describe('progress panel', () => {
    it('shows course progress and an unpressed mark-as-completed button', async () => {
      vi.mocked(fetchCourseTree).mockResolvedValue(tree({ completedLessons: 1, progressPercent: 33 }))
      renderPage('l2')
      const panel = await screen.findByRole('region', { name: /progresso/i })
      expect(within(panel).getByRole('progressbar', { name: /progresso do curso/i })).toHaveAttribute('aria-valuenow', '33')
      expect(within(panel).getByText('33%')).toBeInTheDocument()
      expect(within(panel).getByText('1 de 3 aulas concluídas')).toBeInTheDocument()
      expect(within(panel).getByRole('button', { name: /marcar como concluíd/i })).toHaveAttribute('aria-pressed', 'false')
    })

    it('completes the lesson and refreshes the tree and my courses', async () => {
      const user = userEvent.setup()
      const { invalidate } = renderPage('l2')
      await user.click(await screen.findByRole('button', { name: /marcar como concluíd/i }))
      await waitFor(() => expect(setLessonCompleted).toHaveBeenCalledWith(expect.anything(), 'l2', true))
      const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: readonly string[] }).queryKey.join('/'))
      expect(keys).toEqual(expect.arrayContaining(['student/course-tree', 'student/my-courses']))
    })

    it('shows the completed state with a toggle that unmarks it', async () => {
      const user = userEvent.setup()
      renderPage('l1')
      const button = await screen.findByRole('button', { name: /concluíd/i })
      expect(button).toHaveAttribute('aria-pressed', 'true')
      await user.click(button)
      await waitFor(() => expect(setLessonCompleted).toHaveBeenCalledWith(expect.anything(), 'l1', false))
    })

    it('shows an error when the change fails or has no effect', async () => {
      const user = userEvent.setup()
      vi.mocked(setLessonCompleted).mockResolvedValue(false)
      renderPage('l2')
      await user.click(await screen.findByRole('button', { name: /marcar como concluíd/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível atualizar/i)
    })

    it('shows an error when the request throws', async () => {
      const user = userEvent.setup()
      vi.mocked(setLessonCompleted).mockRejectedValue(new Error('boom'))
      renderPage('l2')
      await user.click(await screen.findByRole('button', { name: /marcar como concluíd/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível atualizar/i)
    })

    it('is hidden for staff', async () => {
      vi.mocked(fetchCourseTree).mockResolvedValue(tree({ isStaff: true }))
      renderPage('l2')
      await screen.findByRole('heading', { level: 1, name: 'JSX' })
      expect(screen.queryByRole('region', { name: /progresso/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /concluíd/i })).not.toBeInTheDocument()
    })
  })

  describe('comments', () => {
    it('shows the comments section for the opened lesson', async () => {
      renderPage('l2')
      expect(await screen.findByRole('heading', { name: 'Comentários' })).toBeInTheDocument()
      await waitFor(() => expect(listLessonComments).toHaveBeenCalledWith(expect.anything(), 'l2', null))
    })

    it('shows the comments section for staff too', async () => {
      vi.mocked(fetchCourseTree).mockResolvedValue(tree({ isStaff: true }))
      renderPage('l2')
      expect(await screen.findByRole('heading', { name: 'Comentários' })).toBeInTheDocument()
    })
  })
})
