import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUserRow } from '../../../../contracts/adminUsers'
import { renderWithProviders } from '../../../../test/renderWithProviders'
import { AdminUsersApiError, setUserActive } from '../api'
import { ToggleActiveDialog } from './ToggleActiveDialog'

vi.mock('../../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), setUserActive: vi.fn() }))

const ACTIVE: AdminUserRow = {
  userId: 'target-1',
  email: 'ana@example.com',
  fullName: 'Ana',
  role: 'student',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
}

function setup(user: AdminUserRow = ACTIVE, onClose = vi.fn()) {
  return { onClose, ...renderWithProviders(<ToggleActiveDialog user={user} onClose={onClose} />) }
}

beforeEach(() => vi.resetAllMocks())

describe('ToggleActiveDialog', () => {
  it('shows email and Ativo -> Inativo when deactivating', () => {
    setup()
    expect(screen.getByText('ana@example.com')).toBeInTheDocument()
    expect(screen.getByText(/Ativo\s*→\s*Inativo/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Desativar usuário' })).toBeInTheDocument()
  })

  it('shows Inativo -> Ativo when reactivating', () => {
    setup({ ...ACTIVE, isActive: false })
    expect(screen.getByText(/Inativo\s*→\s*Ativo/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reativar usuário' })).toBeInTheDocument()
  })

  it('sends active and expectedActive then closes', async () => {
    vi.mocked(setUserActive).mockResolvedValue({ userId: 'target-1', isActive: false })
    const { onClose, invalidate } = setup()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Motivo/), 'abuse')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(setUserActive).toHaveBeenCalledWith(
      { __fake: true },
      { userId: 'target-1', active: false, expectedActive: true, reason: 'abuse' },
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] })
  })

  it('sends expectedActive false when reactivating, without reason', async () => {
    vi.mocked(setUserActive).mockResolvedValue({ userId: 'target-1', isActive: true })
    const { onClose } = setup({ ...ACTIVE, isActive: false })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(setUserActive).mock.calls[0][1]).toEqual({
      userId: 'target-1',
      active: true,
      expectedActive: false,
    })
  })

  it('shows reason counter with 500 limit', async () => {
    setup()
    expect(screen.getByLabelText(/Motivo/)).toHaveAttribute('maxlength', '500')
    await userEvent.setup().type(screen.getByLabelText(/Motivo/), 'ab')
    expect(screen.getByText('2/500')).toBeInTheDocument()
  })

  it('disables confirm while mutating', async () => {
    vi.mocked(setUserActive).mockReturnValue(new Promise(() => {}))
    setup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled())
  })

  it('offers reload on stale_target', async () => {
    vi.mocked(setUserActive).mockRejectedValue(new AdminUsersApiError('stale_target', 'x'))
    const { onClose, invalidate } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    invalidate.mockClear()
    await user.click(await screen.findByRole('button', { name: 'Recarregar lista' }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows describeAdminUsersError message without action for last_superadmin', async () => {
    vi.mocked(setUserActive).mockRejectedValue(new AdminUsersApiError('last_superadmin', 'x'))
    setup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(/último superadministrador/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recarregar lista' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument()
  })

  it('retries after auth_sync_failed with expectedActive equal to the requested state', async () => {
    vi.mocked(setUserActive)
      .mockRejectedValueOnce(new AdminUsersApiError('auth_sync_failed', 'x'))
      .mockResolvedValueOnce({ userId: 'target-1', isActive: false })
    const { onClose } = setup()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Motivo/), '  abuse  ')

    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await user.click(await screen.findByRole('button', { name: 'Tentar novamente' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(setUserActive).toHaveBeenCalledTimes(2)
    expect(vi.mocked(setUserActive).mock.calls[0][1]).toEqual({
      userId: 'target-1', active: false, expectedActive: true, reason: 'abuse',
    })
    expect(vi.mocked(setUserActive).mock.calls[1][1]).toEqual({
      userId: 'target-1', active: false, expectedActive: false, reason: 'abuse',
    })
  })

  it('retries a reactivation with expectedActive true after auth_sync_failed', async () => {
    vi.mocked(setUserActive)
      .mockRejectedValueOnce(new AdminUsersApiError('auth_sync_failed', 'x'))
      .mockResolvedValueOnce({ userId: 'target-1', isActive: true })
    setup({ ...ACTIVE, isActive: false })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await user.click(await screen.findByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(setUserActive).toHaveBeenCalledTimes(2))
    expect(vi.mocked(setUserActive).mock.calls[1][1]).toMatchObject({ active: true, expectedActive: true })
  })

  it('invalidates the list when auth_sync_failed happens so the table shows the flipped flag', async () => {
    vi.mocked(setUserActive).mockRejectedValue(new AdminUsersApiError('auth_sync_failed', 'x'))
    const { invalidate } = setup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar' }))
    await screen.findByRole('button', { name: 'Tentar novamente' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] })
  })
})
