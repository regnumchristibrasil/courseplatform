import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AdminUsersApiError } from '../api'
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog'

function renderDialog(overrides: Partial<ConfirmDialogProps> = {}) {
  const props: ConfirmDialogProps = {
    title: 'Desativar usuário',
    email: 'ana@example.com',
    summary: 'Ativo → Inativo',
    reason: '',
    onReasonChange: vi.fn(),
    error: null,
    isPending: false,
    onConfirm: vi.fn(),
    onRetry: vi.fn(),
    onReload: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<ConfirmDialog {...props} />)
  return props
}

describe('ConfirmDialog', () => {
  it('focuses Cancelar first (destructive confirmation)', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  })

  it('describes the dialog with the user and the summary', () => {
    renderDialog()
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/ana@example\.com.*Ativo → Inativo/)
  })

  it('marks the dialog with ph-no-capture and wraps the email in <bdi>', () => {
    renderDialog()
    expect(screen.getByRole('dialog')).toHaveClass('ph-no-capture')
    expect(screen.getByText('ana@example.com').tagName).toBe('BDI')
  })

  it('cannot be dismissed while pending (X, Cancelar, Escape, backdrop)', async () => {
    const user = userEvent.setup()
    const props = renderDialog({ isPending: true })
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('dialog-backdrop'))
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('can be dismissed when not pending', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('confirms through the form submit (button)', async () => {
    const props = renderDialog()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Enter in the reason textarea inserts a newline and does not submit', async () => {
    const onReasonChange = vi.fn()
    const props = renderDialog({ onReasonChange })
    await userEvent.setup().type(screen.getByLabelText(/Motivo/), '{Enter}')
    expect(onReasonChange).toHaveBeenCalledWith('\n')
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('Ctrl+Enter in the reason textarea confirms', async () => {
    const props = renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText(/Motivo/))
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables Confirmar and ignores submit when confirmDisabled', async () => {
    const props = renderDialog({ confirmDisabled: true })
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText(/Motivo/))
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('does not submit twice while pending (Ctrl+Enter)', async () => {
    const props = renderDialog({ isPending: true })
    screen.getByLabelText(/Motivo/).focus()
    await userEvent.setup().keyboard('{Control>}{Enter}{/Control}')
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('wires the retry button to onRetry (not onConfirm)', async () => {
    const props = renderDialog({ error: new AdminUsersApiError('auth_sync_failed', 'x') })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
})
