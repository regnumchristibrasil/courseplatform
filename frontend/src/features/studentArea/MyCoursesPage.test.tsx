import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyCourse } from '../../contracts/studentArea'
import { renderWithProviders } from '../../test/renderWithProviders'
import { MyCoursesPage } from './MyCoursesPage'
import { fetchMyCourses } from './myCoursesApi'

vi.mock('./myCoursesApi', () => ({ fetchMyCourses: vi.fn() }))

function course(overrides: Partial<MyCourse> = {}): MyCourse {
  return {
    courseId: 'course-1',
    title: 'Introducao ao React',
    courseStatus: 'published',
    isExpired: false,
    expiresAt: null,
    totalLessons: 4,
    completedLessons: 2,
    progressPercent: 50,
    ...overrides,
  }
}

describe('MyCoursesPage', () => {
  beforeEach(() => {
    vi.mocked(fetchMyCourses).mockReset()
  })

  it('shows a loading state first', () => {
    vi.mocked(fetchMyCourses).mockReturnValue(new Promise(() => {}))
    renderWithProviders(<MyCoursesPage />)
    expect(screen.getByRole('status', { name: /carregando seus cursos/i })).toBeInTheDocument()
  })

  it('renders a card with title, progress and the Continuar action', async () => {
    vi.mocked(fetchMyCourses).mockResolvedValue([course()])
    renderWithProviders(<MyCoursesPage />)

    expect(await screen.findByRole('heading', { name: /meus cursos/i, level: 1 })).toBeInTheDocument()
    const card = screen.getByRole('article', { name: 'Introducao ao React' })
    expect(within(card).getByRole('progressbar', { name: /progresso/i })).toHaveAttribute('aria-valuenow', '50')
    expect(within(card).getByText('50%')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /continuar/i })).toHaveAttribute('href', '/meus-cursos/course-1')
    expect(within(card).queryByText(/acesso expirado/i)).not.toBeInTheDocument()
  })

  it('renders an expired card dimmed with progress and Comprar novamente when published', async () => {
    vi.mocked(fetchMyCourses).mockResolvedValue([
      course({ isExpired: true, progressPercent: 75, completedLessons: 3 }),
    ])
    renderWithProviders(<MyCoursesPage />)

    const card = await screen.findByRole('article', { name: 'Introducao ao React' })
    expect(within(card).getByText(/acesso expirado/i)).toBeInTheDocument()
    expect(within(card).getByRole('progressbar', { name: /progresso/i })).toHaveAttribute('aria-valuenow', '75')
    expect(within(card).getByRole('link', { name: /comprar novamente/i })).toHaveAttribute('href', '/')
    expect(within(card).queryByRole('link', { name: /continuar/i })).not.toBeInTheDocument()
    expect(card).toHaveAttribute('data-expired', 'true')
  })

  it('does not offer repurchase when the expired course is not published', async () => {
    vi.mocked(fetchMyCourses).mockResolvedValue([course({ isExpired: true, courseStatus: 'archived' })])
    renderWithProviders(<MyCoursesPage />)

    const card = await screen.findByRole('article', { name: 'Introducao ao React' })
    expect(within(card).getByText(/acesso expirado/i)).toBeInTheDocument()
    expect(within(card).queryByRole('link', { name: /comprar novamente/i })).not.toBeInTheDocument()
  })

  it('renders the empty state with a link to the catalog', async () => {
    vi.mocked(fetchMyCourses).mockResolvedValue([])
    renderWithProviders(<MyCoursesPage />)

    expect(await screen.findByText(/voce ainda nao tem cursos|você ainda não tem cursos/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver catálogo/i })).toHaveAttribute('href', '/')
  })

  it('shows an error with retry', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchMyCourses).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(fetchMyCourses).mockResolvedValueOnce([course()])
    renderWithProviders(<MyCoursesPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível carregar seus cursos/i)
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(await screen.findByRole('article', { name: 'Introducao ao React' })).toBeInTheDocument()
  })
})
