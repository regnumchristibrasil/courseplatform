import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUserRow, Role } from '../../../contracts/adminUsers'
import { ACTOR_ID, renderWithProviders } from '../../../test/renderWithProviders'
import { fetchCurrentAccess } from '../../authz/currentAccessApi'
import { listAdminUsers } from './api'
import AdminUsersPage from './AdminUsersPage'

vi.mock('../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('../../authz/currentAccessApi', () => ({ fetchCurrentAccess: vi.fn() }))
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), listAdminUsers: vi.fn() }))

function row(userId: string, role: Role): AdminUserRow {
  return { userId, email: `${userId}@example.com`, fullName: userId, role, isActive: true, createdAt: '2026-01-01T00:00:00Z' }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'admin', isActive: true })
})

describe('AdminUsersPage', () => {
  it('shows a spinner while loading', () => {
    vi.mocked(listAdminUsers).mockReturnValue(new Promise(() => {}))
    renderWithProviders(<AdminUsersPage />)
    expect(screen.getByRole('status', { name: 'Carregando usuários...' })).toBeInTheDocument()
  })

  it('renders rows and total count', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [row('stu', 'student')], total: 1 })
    renderWithProviders(<AdminUsersPage />)
    expect(await screen.findByText('stu@example.com')).toBeInTheDocument()
    expect(screen.getByText('1 usuário(s)')).toBeInTheDocument()
  })

  it('shows empty state with no results', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [], total: 0 })
    renderWithProviders(<AdminUsersPage />)
    expect(await screen.findByText('Nenhum usuário encontrado.')).toBeInTheDocument()
  })

  it('shows an error alert when the list fails', async () => {
    vi.mocked(listAdminUsers).mockRejectedValue(new Error('boom'))
    renderWithProviders(<AdminUsersPage />)
    expect(await screen.findByText(/erro inesperado/)).toBeInTheDocument()
  })

  it('hides actions on the own row', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [row(ACTOR_ID, 'admin'), row('stu', 'student')], total: 2 })
    renderWithProviders(<AdminUsersPage />)
    const own = await screen.findByRole('row', { name: new RegExp(`${ACTOR_ID}@example.com`) })
    expect(within(own).queryByRole('button')).not.toBeInTheDocument()
  })

  it('opens the change role dialog for a row', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [row('stu', 'student')], total: 1 })
    renderWithProviders(<AdminUsersPage />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Alterar papel de stu@example.com' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('stu@example.com')).toBeInTheDocument()
  })

  it('paginates and resets to page 1 on filter change', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [row('stu', 'student')], total: 60 })
    renderWithProviders(<AdminUsersPage />, { route: '/admin/users?page=3' })
    const user = userEvent.setup()
    await screen.findByText('stu@example.com')
    expect(listAdminUsers).toHaveBeenLastCalledWith({ __fake: true }, expect.objectContaining({ offset: 40 }))
    await user.selectOptions(screen.getByLabelText('Papel'), 'tutor')
    await screen.findByText('stu@example.com')
    expect(listAdminUsers).toHaveBeenLastCalledWith(
      { __fake: true },
      expect.objectContaining({ role: 'tutor', offset: 0 }),
    )
  })

  it('goes to the next page', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [row('stu', 'student')], total: 60 })
    renderWithProviders(<AdminUsersPage />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Próxima' }))
    expect(listAdminUsers).toHaveBeenLastCalledWith({ __fake: true }, expect.objectContaining({ offset: 20 }))
  })

  it('does not crash with a page far beyond the last page and still lists rows', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [row('stu', 'student')], total: 100 })
    renderWithProviders(<AdminUsersPage />, { route: '/admin/users?page=100' })
    expect(await screen.findByText('stu@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página 5' })).toBeInTheDocument()
  })

  it('returns to page 1 (replace) when a page past the end comes back empty', async () => {
    vi.mocked(listAdminUsers).mockImplementation(async (_client, req) =>
      req.offset === 0 ? { users: [row('stu', 'student')], total: 3 } : { users: [], total: 0 },
    )
    renderWithProviders(<AdminUsersPage />, { route: '/admin/users?page=7' })
    expect(await screen.findByText('stu@example.com')).toBeInTheDocument()
    expect(listAdminUsers).toHaveBeenLastCalledWith({ __fake: true }, expect.objectContaining({ offset: 0 }))
  })

  it('replaces (does not push) the history entry when resetting the page', async () => {
    vi.mocked(listAdminUsers).mockImplementation(async (_client, req) =>
      req.offset === 0 ? { users: [row('stu', 'student')], total: 3 } : { users: [], total: 0 },
    )
    const { router } = renderWithProviders(<AdminUsersPage />, { route: '/admin/users?page=7' })
    await screen.findByText('stu@example.com')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('marks the whole page with ph-no-capture (PII)', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [row('stu', 'student')], total: 1 })
    renderWithProviders(<AdminUsersPage />)
    await screen.findByText('stu@example.com')
    expect(screen.getByRole('heading', { name: 'Usuários' }).closest('section')).toHaveClass('ph-no-capture')
  })

  it('shows previous rows as busy with disabled actions while the next page loads', async () => {
    vi.mocked(listAdminUsers).mockImplementation((_client, req) =>
      req.offset === 0 ? Promise.resolve({ users: [row('stu', 'student')], total: 60 }) : new Promise(() => {}),
    )
    renderWithProviders(<AdminUsersPage />)
    await screen.findByText('stu@example.com')
    expect(screen.getByRole('table')).not.toHaveAttribute('aria-busy')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Próxima' }))

    await waitFor(() => expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true'))
    expect(screen.getByRole('button', { name: 'Alterar papel de stu@example.com' })).toBeDisabled()
  })

  it('on a refetch error keeps one clear state: alert with retry and a stale, disabled table', async () => {
    vi.mocked(listAdminUsers).mockResolvedValueOnce({ users: [row('stu', 'student')], total: 1 })
    const { invalidate, queryClient } = renderWithProviders(<AdminUsersPage />)
    await screen.findByText('stu@example.com')
    vi.mocked(listAdminUsers).mockRejectedValue(new Error('boom'))
    invalidate.mockClear()

    await act(() => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }))

    expect(await screen.findByText(/erro inesperado/)).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Alterar papel de stu@example.com' })).toBeDisabled()
  })

  it('restores the search input when the browser goes back', async () => {
    vi.mocked(listAdminUsers).mockResolvedValue({ users: [row('stu', 'student')], total: 1 })
    const { router } = renderWithProviders(<AdminUsersPage />)
    await screen.findByText('stu@example.com')
    await userEvent.setup().type(screen.getByLabelText('Buscar'), 'ana')
    await waitFor(() => expect(router.state.location.search).toBe('?q=ana'), { timeout: 3000 })

    await act(() => router.navigate(-1))

    await waitFor(() => expect(screen.getByLabelText('Buscar')).toHaveValue(''))
  })
})
