import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>Salvar</Button>)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
  })

  it('defaults to type="button" so it never accidentally submits a form', () => {
    render(<Button>Cancelar</Button>)
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveAttribute('type', 'button')
  })

  it('honors an explicit type="submit"', () => {
    render(<Button type="submit">Enviar</Button>)
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveAttribute('type', 'submit')
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Continuar</Button>)

    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not call onClick when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Continuar
      </Button>,
    )

    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('disables the button and marks it busy while isLoading is true', () => {
    render(<Button isLoading>Enviando</Button>)
    const button = screen.getByRole('button', { name: 'Enviando' })

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('applies the requested variant as a class name', () => {
    render(<Button variant="danger">Excluir</Button>)
    expect(screen.getByRole('button', { name: 'Excluir' }).className).toMatch(/danger/)
  })

  it('forwards arbitrary native button attributes', () => {
    render(<Button data-testid="my-button">OK</Button>)
    expect(screen.getByTestId('my-button')).toBeInTheDocument()
  })
})
