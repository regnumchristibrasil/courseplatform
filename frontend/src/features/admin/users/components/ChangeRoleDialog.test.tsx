import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUserRow } from '../../../../contracts/adminUsers'
import { ACTOR_ID, renderWithProviders } from '../../../../test/renderWithProviders'
import { AdminUsersApiError, setUserRole } from '../api'
import { ChangeRoleDialog } from './ChangeRoleDialog'

vi.mock('../../../../lib/supabaseClient', () => ({ supabase: { __fake: true } }))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), setUserRole: vi.fn() }))

const TARGET: AdminUserRow = {
  userId: 'target-1',
  email: 'ana@example.com',
  fullName: 'Ana',
  role: 'student',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
}

function setup(actorRole: 'admin' | 'superadmin' | 'tutor' = 'admin', onClose = vi.fn(), user: AdminUserRow = TARGET) {
  return {
    onClose,
    ...renderWithProviders(<ChangeRoleDialog user={user} actorId={ACTOR_ID} actorRole={actorRole} onClose={onClose} />),
  }
}

beforeEach(() => vi.resetAllMocks())

describe('ChangeRoleDialog', () => {
  it('shows target email and from -> to summary', () => {
    setup()
    expect(screen.getByText('ana@example.com')).toBeInTheDocument()
    expect(screen.getByText(/Aluno\s*→\s*Tutor/)).toBeInTheDocument()
  })

  it('offers only assignable roles other than the current one', () => {
    setup('admin')
    const options = Array.from(screen.getByLabelText('Novo papel').querySelectorAll('option')).map((o) => o.value)
    expect(options).toEqual(['tutor'])
  })

  it('offers every other role to a superadmin', () => {
    setup('superadmin')
    const options = Array.from(screen.getByLabelText('Novo papel').querySelectorAll('option')).map((o) => o.value)
    expect(options).toEqual(['superadmin', 'admin', 'tutor'])
  })

  it('warns when granting admin or superadmin', async () => {
    setup('superadmin')
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Novo papel'), 'tutor')
    expect(screen.queryByText(/acesso administrativo/i)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Novo papel'), 'admin')
    expect(screen.getByText(/acesso administrativo/i)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Novo papel'), 'superadmin')
    expect(screen.getByText(/acesso administrativo/i)).toBeInTheDocument()
  })

  it('sends role, expectedRole and trimmed reason, then closes', async () => {
    vi.mocked(setUserRole).mockResolvedValue({ userId: 'target-1', role: 'tutor' })
    const { onClose, invalidate } = setup()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Motivo/), '  promoted  ')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(setUserRole).toHaveBeenCalledWith(
      { __fake: true },
      { userId: 'target-1', role: 'tutor', expectedRole: 'student', reason: 'promoted' },
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] })
  })

  it('omits reason when blank', async () => {
    vi.mocked(setUserRole).mockResolvedValue({ userId: 'target-1', role: 'tutor' })
    const { onClose } = setup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(setUserRole).mock.calls[0][1]).not.toHaveProperty('reason')
  })

  it('shows a reason counter capped at 500 characters', async () => {
    setup()
    const field = screen.getByLabelText(/Motivo/)
    expect(field).toHaveAttribute('maxlength', '500')
    expect(screen.getByText('0/500')).toBeInTheDocument()
    await userEvent.setup().type(field, 'abc')
    expect(screen.getByText('3/500')).toBeInTheDocument()
  })

  it('disables confirm while the mutation is pending', async () => {
    vi.mocked(setUserRole).mockReturnValue(new Promise(() => {}))
    setup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled())
  })

  it('shows stale_target error with a reload action that invalidates the list and closes', async () => {
    vi.mocked(setUserRole).mockRejectedValue(new AdminUsersApiError('stale_target', 'x'))
    const { onClose, invalidate } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(/alterado por outra pessoa/)).toBeInTheDocument()
    invalidate.mockClear()
    await user.click(screen.getByRole('button', { name: 'Recarregar lista' }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] })
    expect(onClose).toHaveBeenCalled()
  })

  it('offers retry for auth_sync_failed and resubmits', async () => {
    vi.mocked(setUserRole).mockRejectedValueOnce(new AdminUsersApiError('auth_sync_failed', 'x'))
    vi.mocked(setUserRole).mockResolvedValueOnce({ userId: 'target-1', role: 'tutor' })
    const { onClose } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await user.click(await screen.findByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(setUserRole).toHaveBeenCalledTimes(2)
  })

  it('maps unknown errors to the internal message', async () => {
    vi.mocked(setUserRole).mockRejectedValue(new Error('boom'))
    setup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(/erro inesperado/)).toBeInTheDocument()
  })

  it('disables confirm and offers no option when the actor cannot assign any role', async () => {
    setup('tutor')
    expect(screen.getByLabelText('Novo papel').querySelectorAll('option')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })

  it('offers no role (and no confirm) for the actor own row, from the contract self rule', () => {
    setup('superadmin', vi.fn(), { ...TARGET, userId: ACTOR_ID })
    expect(screen.getByLabelText('Novo papel').querySelectorAll('option')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })

  it('does not call the api via Ctrl+Enter when confirm is disabled', async () => {
    setup('tutor')
    const user = userEvent.setup()
    await user.click(screen.getByLabelText(/Motivo/))
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(setUserRole).not.toHaveBeenCalled()
  })

  it('cancel closes without calling the api', async () => {
    const { onClose } = setup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalled()
    expect(setUserRole).not.toHaveBeenCalled()
  })
})
