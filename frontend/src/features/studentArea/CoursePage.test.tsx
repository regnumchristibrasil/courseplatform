import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseTree } from '../../contracts/studentArea'
import { renderWithProviders } from '../../test/renderWithProviders'
import { CoursePage } from './CoursePage'
import { fetchCourseTree } from './courseTreeApi'

vi.mock('./courseTreeApi', () => ({ fetchCourseTree: vi.fn() }))

function tree(overrides: Partial<CourseTree> = {}): CourseTree {
  return {
    courseId: 'course-1',
    title: 'Introducao ao React',
    description: 'Aprenda do zero.',
    courseStatus: 'published',
    isStaff: false,
    totalLessons: 3,
    completedLessons: 1,
    progressPercent: 33,
    totalDurationSeconds: 3900,
    continueLessonId: 'l2',
    modules: [
      {
        id: 'm1',
        title: 'Fundamentos',
        lessons: [
          { id: 'l1', title: 'Boas-vindas', durationSeconds: 300, state: 'completed' },
          { id: 'l2', title: 'JSX', durationSeconds: 3600, state: 'in_progress' },
        ],
      },
      {
        id: 'm2',
        title: 'Estado',
        lessons: [{ id: 'l3', title: 'useState', durationSeconds: null, state: 'not_started' }],
      },
    ],
    ...overrides,
  }
}

function renderPage(route = '/meus-cursos/course-1') {
  return renderWithProviders(
    <Routes>
      <Route path="/meus-cursos/:courseId" element={<CoursePage />} />
    </Routes>,
    { route },
  )
}

describe('CoursePage', () => {
  beforeEach(() => {
    vi.mocked(fetchCourseTree).mockReset()
  })

  it('shows a loading state first', () => {
    vi.mocked(fetchCourseTree).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('status', { name: /carregando o curso/i })).toBeInTheDocument()
  })

  it('requests the tree for the course id in the URL', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(tree())
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Introducao ao React' })
    expect(fetchCourseTree).toHaveBeenCalledWith(expect.anything(), 'course-1')
  })

  it('renders the side column with description, duration, count and progress', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(tree())
    renderPage()

    const side = await screen.findByRole('complementary', { name: /sobre o curso/i })
    expect(within(side).getByRole('heading', { level: 1, name: 'Introducao ao React' })).toBeInTheDocument()
    expect(within(side).getByText('Aprenda do zero.')).toBeInTheDocument()
    expect(within(side).getByText('1h 05min')).toBeInTheDocument()
    expect(within(side).getByText('3 conteúdos')).toBeInTheDocument()
    expect(within(side).getByRole('progressbar', { name: /progresso do curso/i })).toHaveAttribute('aria-valuenow', '33')
    expect(within(side).getByText('33%')).toBeInTheDocument()
  })

  it('uses the singular for a single content and omits a missing description', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(
      tree({ description: null, totalLessons: 1, totalDurationSeconds: 0, modules: [] }),
    )
    renderPage()
    const side = await screen.findByRole('complementary', { name: /sobre o curso/i })
    expect(within(side).getByText('1 conteúdo')).toBeInTheDocument()
    expect(within(side).queryByText(/min|h /)).not.toBeInTheDocument()
  })

  it('links Continuar de onde parei to the continue lesson', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(tree())
    renderPage()
    expect(await screen.findByRole('link', { name: /continuar de onde parei/i })).toHaveAttribute(
      'href',
      '/meus-cursos/course-1/aulas/l2',
    )
  })

  it('shows Revisar curso when every lesson is completed', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(
      tree({ completedLessons: 3, progressPercent: 100, continueLessonId: 'l1' }),
    )
    renderPage()
    const link = await screen.findByRole('link', { name: /revisar curso/i })
    expect(link).toHaveAttribute('href', '/meus-cursos/course-1/aulas/l1')
    expect(screen.queryByRole('link', { name: /continuar de onde parei/i })).not.toBeInTheDocument()
  })

  it('omits the action when there is no lesson to open', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(
      tree({ totalLessons: 0, completedLessons: 0, progressPercent: 0, continueLessonId: null, modules: [] }),
    )
    renderPage()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('link', { name: /continuar|revisar/i })).not.toBeInTheDocument()
  })

  it('renders modules expanded by default with lesson rows (title, duration, state)', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(tree())
    renderPage()

    const first = await screen.findByRole('group', { name: 'Fundamentos' })
    expect(first).toHaveAttribute('open')
    expect(within(first).getByRole('link', { name: /boas-vindas/i })).toHaveAttribute(
      'href',
      '/meus-cursos/course-1/aulas/l1',
    )
    expect(within(first).getByText('5min')).toBeInTheDocument()
    expect(within(first).getByText('Concluída')).toBeInTheDocument()
    expect(within(first).getByText('Em andamento')).toBeInTheDocument()
    expect(within(first).getByText('1h')).toBeInTheDocument()

    const second = screen.getByRole('group', { name: 'Estado' })
    expect(second).toHaveAttribute('open')
    expect(within(second).getByText('Não iniciada')).toBeInTheDocument()
  })

  it('lets the student collapse a module', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(tree())
    renderPage()

    const module = await screen.findByRole('group', { name: 'Fundamentos' })
    await userEvent.click(within(module).getByText('Fundamentos'))
    expect(module).not.toHaveAttribute('open')
  })

  it('hides progress and the continue action for staff', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(tree({ isStaff: true }))
    renderPage()

    const side = await screen.findByRole('complementary', { name: /sobre o curso/i })
    expect(within(side).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(side).queryByRole('link', { name: /continuar|revisar/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Concluída')).not.toBeInTheDocument()
    expect(screen.queryByText('Em andamento')).not.toBeInTheDocument()
  })

  it('renders the generic not-found page when the server returns no row', async () => {
    vi.mocked(fetchCourseTree).mockResolvedValue(null)
    renderPage()
    expect(await screen.findByRole('heading', { name: /página não encontrada/i })).toBeInTheDocument()
  })

  it('offers a retry on load failure', async () => {
    vi.mocked(fetchCourseTree).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(tree())
    renderPage()

    expect(await screen.findByText(/não foi possível carregar o curso/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Introducao ao React' })).toBeInTheDocument()
  })
})
