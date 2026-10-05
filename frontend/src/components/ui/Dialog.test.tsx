import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

function Harness({ onClose = vi.fn() }: { readonly onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <Dialog
        open={open}
        title="Confirmar"
        onClose={() => {
          onClose()
          setOpen(false)
        }}
      >
        <button>Primeiro</button>
        <button>Ultimo</button>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} title="Confirmar" onClose={vi.fn()}>
        corpo
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('exposes role=dialog, aria-modal and an accessible name from the title', () => {
    render(
      <Dialog open title="Confirmar" onClose={vi.fn()}>
        corpo
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Confirmar' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('corpo')).toBeInTheDocument()
  })

  it('moves focus into the dialog on open', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('returns focus to the trigger after closing', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Abrir' })
    await user.click(trigger)

    await user.keyboard('{Escape}')

    expect(trigger).toHaveFocus()
  })

  it('traps focus: Tab from last wraps to first, Shift+Tab from first wraps to last', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    const first = screen.getByRole('button', { name: 'Fechar' })
    const last = screen.getByRole('button', { name: 'Ultimo' })

    last.focus()
    await user.tab()
    expect(first).toHaveFocus()

    await user.tab({ shift: true })
    expect(last).toHaveFocus()
  })

  it('closes when the close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))

    await user.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on backdrop click but not on content click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Dialog open title="Confirmar" onClose={onClose}>
        corpo
      </Dialog>,
    )

    await user.click(screen.getByText('corpo'))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the footer when provided', () => {
    render(
      <Dialog open title="Confirmar" onClose={vi.fn()} footer={<span>rodape</span>}>
        corpo
      </Dialog>,
    )
    expect(screen.getByText('rodape')).toBeInTheDocument()
  })

  it('focuses the [data-autofocus] element instead of the first focusable one', () => {
    render(
      <Dialog open title="Confirmar" onClose={vi.fn()}>
        <button>Primeiro</button>
        <button data-autofocus>Cancelar</button>
      </Dialog>,
    )
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  })

  it('links the description with aria-describedby', () => {
    render(
      <Dialog open title="Confirmar" onClose={vi.fn()} description={<span>Descrição do diálogo</span>}>
        corpo
      </Dialog>,
    )
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Descrição do diálogo')
  })

  it('does not set aria-describedby without a description', () => {
    render(
      <Dialog open title="Confirmar" onClose={vi.fn()}>
        corpo
      </Dialog>,
    )
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby')
  })

  it('applies panelClassName to the dialog panel', () => {
    render(
      <Dialog open title="Confirmar" onClose={vi.fn()} panelClassName="ph-no-capture">
        corpo
      </Dialog>,
    )
    expect(screen.getByRole('dialog')).toHaveClass('ph-no-capture')
  })

  it('closes on Escape even when focus is outside the panel (document-level listener)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <>
        <button>Fora</button>
        <Dialog open title="Confirmar" onClose={onClose}>
          corpo
        </Dialog>
      </>,
    )
    screen.getByRole('button', { name: 'Fora' }).focus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pulls focus back into the panel when Tab is pressed with focus outside', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>Fora</button>
        <Dialog open title="Confirmar" onClose={vi.fn()}>
          <button>Dentro</button>
        </Dialog>
      </>,
    )
    const outside = screen.getByRole('button', { name: 'Fora' })
    outside.focus()
    await user.tab()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    outside.focus()
    await user.tab({ shift: true })
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
  })

  it('locks body scroll while open and restores it on close', () => {
    document.body.style.overflow = 'auto'
    const { rerender } = render(
      <Dialog open title="Confirmar" onClose={vi.fn()}>
        corpo
      </Dialog>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <Dialog open={false} title="Confirmar" onClose={vi.fn()}>
        corpo
      </Dialog>,
    )
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  describe('dismissible=false', () => {
    function renderLocked(onClose = vi.fn()) {
      render(
        <Dialog open title="Confirmar" onClose={onClose} dismissible={false}>
          <button>Dentro</button>
        </Dialog>,
      )
      return onClose
    }

    it('ignores Escape', async () => {
      const onClose = renderLocked()
      await userEvent.setup().keyboard('{Escape}')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('ignores backdrop clicks', async () => {
      const onClose = renderLocked()
      await userEvent.setup().click(screen.getByTestId('dialog-backdrop'))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('disables the close button', async () => {
      const onClose = renderLocked()
      const close = screen.getByRole('button', { name: 'Fechar' })
      expect(close).toBeDisabled()
      await userEvent.setup().click(close)
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
