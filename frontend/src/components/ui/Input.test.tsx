import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Input } from './Input'

describe('Input', () => {
  it('associates the label with the input via htmlFor/id', () => {
    render(<Input label="E-mail" id="email" value="" onChange={() => {}} />)
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
  })

  it('generates a stable id when none is provided, keeping label association intact', () => {
    render(<Input label="Nome" value="" onChange={() => {}} />)
    expect(screen.getByLabelText('Nome')).toBeInTheDocument()
  })

  it('calls onChange as the user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input label="Nome" value="" onChange={onChange} />)

    await user.type(screen.getByLabelText('Nome'), 'a')

    expect(onChange).toHaveBeenCalled()
  })

  it('renders no error message and no aria-invalid by default', () => {
    render(<Input label="Nome" value="" onChange={() => {}} />)
    const input = screen.getByLabelText('Nome')

    expect(input).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the error message and marks the field invalid when error is set', () => {
    render(<Input label="E-mail" value="" onChange={() => {}} error="Informe um e-mail válido." />)
    const input = screen.getByLabelText('E-mail')

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um e-mail válido.')
    expect(input).toHaveAccessibleDescription('Informe um e-mail válido.')
  })

  it('forwards native input attributes such as type and placeholder', () => {
    render(
      <Input
        label="Senha"
        value=""
        onChange={() => {}}
        type="password"
        placeholder="Sua senha"
      />,
    )
    const input = screen.getByLabelText('Senha')

    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('placeholder', 'Sua senha')
  })
})
