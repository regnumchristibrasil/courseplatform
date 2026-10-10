import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { useCurrentAccess } from '../../authz/useCurrentAccess'
import { AdminCoursesApiError, saveCourse } from './api'
import AdminCourseCreatePage from './AdminCourseCreatePage'

vi.mock('../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('../../authz/useCurrentAccess', () => ({ useCurrentAccess: vi.fn() }))
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), saveCourse: vi.fn() }))

function asRole(role: 'admin' | 'tutor') {
  vi.mocked(useCurrentAccess).mockReturnValue({ data: { role, isActive: true } } as ReturnType<typeof useCurrentAccess>)
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/courses/new" element={<AdminCourseCreatePage />} />
      <Route path="/admin/courses/:courseId" element={<p>detalhe do curso</p>} />
    </Routes>,
    { route: '/admin/courses/new' },
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('AdminCourseCreatePage', () => {
  it('lets an admin create a draft with price and duration, then opens the course', async () => {
    asRole('admin')
    vi.mocked(saveCourse).mockResolvedValue({ courseId: 'c9', updatedAt: '2026-10-09T00:00:00.000001+00:00' })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Título'), 'Novo curso')
    await user.type(screen.getByLabelText('Preço (R$)'), '99,90')
    await user.type(screen.getByLabelText('Duração do acesso (dias)'), '90')
    await user.click(screen.getByRole('button', { name: 'Criar curso' }))

    expect(saveCourse).toHaveBeenCalledWith({ __fake: true }, {
      action: 'create',
      title: 'Novo curso',
      description: null,
      priceCents: 9990,
      accessDurationDays: 90,
    })
    expect(await screen.findByText('detalhe do curso')).toBeInTheDocument()
  })

  it('lets a tutor create a draft with no price; commercial fields are read-only', async () => {
    asRole('tutor')
    vi.mocked(saveCourse).mockResolvedValue({ courseId: 'c9', updatedAt: 'x' })
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByLabelText('Preço (R$)')).toHaveAttribute('readonly')
    await user.type(screen.getByLabelText('Título'), 'Rascunho do tutor')
    await user.click(screen.getByRole('button', { name: 'Criar curso' }))

    expect(saveCourse).toHaveBeenCalledWith({ __fake: true }, expect.objectContaining({ action: 'create', priceCents: null, accessDurationDays: null }))
  })

  it('shows the mapped message when the server denies the request', async () => {
    asRole('admin')
    vi.mocked(saveCourse).mockRejectedValue(new AdminCoursesApiError('forbidden', 'forbidden'))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Título'), 'Curso')
    await user.click(screen.getByRole('button', { name: 'Criar curso' }))

    expect(await screen.findByText('Você não tem permissão para esta alteração.')).toBeInTheDocument()
  })

  it('links back to the list', () => {
    asRole('admin')
    renderPage()
    expect(screen.getByRole('link', { name: 'Voltar para cursos' })).toHaveAttribute('href', '/admin/courses')
  })
})
